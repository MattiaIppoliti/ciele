/**
 * Graph-sync jobs: keep each Knowledge Collection's derived Knowledge Graph in
 * step with its OKF Concepts (ADR-0017). Every create/update/delete of a
 * Concept enqueues one `graph_sync_concept` job (see `enqueueGraphSyncJob` in
 * `./jobs`) that pushes, or removes, that Concept's document on the graph
 * worker, tagged so a graph answer resolves back to Concept → Source. Deleting a
 * whole Collection (or the Assistant that owns it) instead enqueues one `purge`
 * job per Collection, which drops the entire dataset in a single worker call.
 *
 * OKF stays the system of record; this only projects it onto the graph. The
 * payload is rehydrated from the Db at run time (like `ingest_source`), so a
 * Concept edited between enqueue and run syncs its latest body.
 *
 * This module holds only the *performer* + payload shapes, deliberately no
 * import of `./jobs`, so the ledger (which imports `./ingest`, which enqueues
 * these) has no import cycle. The handler registration + enqueue live in
 * `./jobs`.
 */

import { createHash } from "node:crypto";
import type { AiUsageInput, Concept } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import {
  acknowledgeConceptInventory,
  type GraphWorkerUsage,
  graphUsageProvider,
  ingestConcepts,
  indexConceptInventory,
  isGraphWorkerConfigured,
  purgeCollection,
  reconcileConceptInventory,
  reconcileLegacyConceptInventory,
  removeConcept,
  resumeConceptReconciliation,
  sweepConceptInventory,
} from "./graph-worker";
import { meterUsage } from "./usage";
import {
  admitAiSpend,
  CONVERSATION_SPEND_CAPACITY,
} from "./spend-admission";

export const GRAPH_SYNC_KIND = "graph_sync_concept" as const;
const GRAPH_RECONCILE_PAGE_SIZE = 100;
const GRAPH_RECONCILE_PAGE_BUDGET = 6;

/**
 * A unit of graph-sync work carried on the `graph_sync_concept` ledger kind.
 * Two shapes share the kind because both run through the same handler + cron
 * backstop:
 *  - Concept-scoped (`ingest` / `remove`): (re)build or drop one Concept's graph
 *    document, needs `conceptId`.
 *  - Collection-scoped (`purge`): drop a whole Collection's dataset on Collection
 *    or Assistant delete, no Concept, so no `conceptId` (a per-Concept remove
 *    fan-out would be unbounded for a large collection; ADR-0017 follow-up).
 * The graph dataset is keyed by `collectionId` alone in every case.
 */
export type GraphSyncJob =
  | {
      kind: typeof GRAPH_SYNC_KIND;
      op: "ingest" | "remove";
      collectionId: string;
      conceptId: string;
    }
  | {
      kind: typeof GRAPH_SYNC_KIND;
      op: "purge";
      collectionId: string;
    };

/** A GraphSyncJob minus the fixed `kind`, the caller-supplied shape passed to
 * `enqueueGraphSyncJob`. Distributes over the union so each member keeps its own
 * fields (a plain `Omit` would collapse to the shared keys and lose `conceptId`
 * from the ingest/remove shape). */
export type GraphSyncJobInput = GraphSyncJob extends infer T
  ? T extends unknown
    ? Omit<T, "kind">
    : never
  : never;

/** Validates + narrows a ledger row's payload into a GraphSyncJob. */
export function graphSyncJobFromRecord(record: { payload: unknown }): GraphSyncJob {
  const payload = record.payload as Partial<GraphSyncJob>;
  if (payload.kind !== GRAPH_SYNC_KIND || !payload.collectionId) {
    throw new Error("Invalid graph-sync job payload");
  }
  if (payload.op === "purge") {
    return { kind: GRAPH_SYNC_KIND, op: "purge", collectionId: payload.collectionId };
  }
  if ((payload.op === "ingest" || payload.op === "remove") && payload.conceptId) {
    return {
      kind: GRAPH_SYNC_KIND,
      op: payload.op,
      collectionId: payload.collectionId,
      conceptId: payload.conceptId,
    };
  }
  throw new Error("Invalid graph-sync job payload");
}

/**
 * Runs one graph-sync job against the graph worker. A no-op when the worker is
 * unconfigured, so the whole layer stays inert without a sidecar. For `ingest`,
 * a Concept that has since been deleted or marked excluded is removed from the
 * graph instead, keeping the index a faithful projection of the searchable
 * OKF Concepts.
 */
export async function performGraphSyncConcept(
  job: GraphSyncJob,
  deps: { db: Db }
): Promise<void> {
  if (!isGraphWorkerConfigured()) return;

  if (job.op === "purge") {
    // Whole-collection drop (Collection/Assistant deleted): reclaim the dataset
    // in one worker call rather than a per-Concept remove fan-out. There is no
    // OKF to reconcile against: the Collection is gone.
    await purgeCollection(job.collectionId);
    return;
  }

  if (job.op === "remove") {
    await removeConcept(job.collectionId, job.conceptId);
    return;
  }

  const concept = await deps.db.getConcept(job.conceptId);
  if (!concept || concept.excluded) {
    // Gone or excluded from the search index since enqueue, mirror that on
    // the graph rather than leaving a stale document behind.
    await removeConcept(job.collectionId, job.conceptId);
    return;
  }

  const title = concept.frontmatter.title ?? concept.path;
  const text = `${title}\n\n${concept.body}`;
  const collection = await deps.db.getCollection(job.collectionId);
  if (!collection) return;
  const admission = await admitAiSpend({
    db: deps.db,
    organizationId: collection.organizationId,
    connectionKinds: ["platform"],
    capacity: CONVERSATION_SPEND_CAPACITY,
  });
  if (admission.blocked) throw new Error(admission.blocked.detail);
  try {
    const { usage } = await ingestConcepts(job.collectionId, [
      {
        conceptId: concept.id,
        sourceId: concept.sourceId,
        // Title-prefixed like the pgvector index, so the graph sees the same text.
        text,
        contentHash: graphContentHash(text),
      },
    ]);
    if (usage) {
      const row = await graphUsageInput(deps.db, job.collectionId, usage);
      await admission.settle(row ? [row] : []);
    }
  } finally {
    await admission.release();
  }
}

/**
 * Compare one derived graph dataset with authoritative OKF inventory. The
 * worker removes stale IDs and returns only missing or content-changed IDs;
 * callers enqueue those through the admitted graph-sync job path.
 */
export async function reconcileGraphDataset(
  db: Db,
  collectionId: string,
  onMissing: (conceptId: string, jobId?: string) => Promise<void>,
): Promise<{ missing: number; removed: number; complete: boolean }> {
  if (!isGraphWorkerConfigured()) {
    return { missing: 0, removed: 0, complete: true };
  }

  let state = await resumeConceptReconciliation(collectionId);
  // One-deploy compatibility: an old worker only supports the original
  // one-shot contract. New workers use the bounded resumable path below.
  if (state === null) return { missing: 0, removed: 0, complete: true };
  if (state === "legacy") {
    const desired: Array<{ conceptId: string; contentHash: string }> = [];
    let afterId: string | undefined;
    for (;;) {
      const concepts = await db.listConceptPage(collectionId, {
        afterId,
        limit: GRAPH_RECONCILE_PAGE_SIZE,
      });
      desired.push(...concepts.filter((concept) => !concept.excluded).map(desiredConcept));
      if (concepts.length < GRAPH_RECONCILE_PAGE_SIZE) break;
      afterId = concepts.at(-1)!.id;
    }
    const legacy = await reconcileLegacyConceptInventory(collectionId, desired);
    if (legacy === null) return { missing: 0, removed: 0, complete: true };
    for (const conceptId of legacy.missingConceptIds) await onMissing(conceptId);
    return {
      missing: legacy.missingConceptIds.length,
      removed: legacy.removed,
      complete: true,
    };
  }

  let missing = 0;
  let removed = 0;
  for (let step = 0; step < GRAPH_RECONCILE_PAGE_BUDGET; step += 1) {
    if (state.phase === "index") {
      state = await indexConceptInventory(collectionId, GRAPH_RECONCILE_PAGE_SIZE);
      continue;
    }
    if (state.phase === "mark") {
      const concepts = await db.listConceptPage(collectionId, {
        afterId: state.cursor ?? undefined,
        limit: GRAPH_RECONCILE_PAGE_SIZE,
      });
      const desiredDone = concepts.length < GRAPH_RECONCILE_PAGE_SIZE;
      const nextCursor = desiredDone ? null : concepts.at(-1)!.id;
      const page = await reconcileConceptInventory(
        collectionId,
        state.cursor,
        concepts.filter((concept) => !concept.excluded).map(desiredConcept),
        nextCursor,
        desiredDone,
      );
      state = page;
      continue;
    }
    if (state.phase === "deliver") {
      for (const conceptId of state.missingConceptIds ?? []) {
        await onMissing(conceptId, reconciliationJobId(state.epoch, conceptId));
        missing += 1;
      }
      state = await acknowledgeConceptInventory(collectionId);
      continue;
    }
    if (state.phase === "sweep") {
      const page = await sweepConceptInventory(
        collectionId,
        GRAPH_RECONCILE_PAGE_SIZE,
      );
      removed += page.removed;
      state = page;
      if (page.done) return { missing, removed, complete: true };
      continue;
    }
    return { missing, removed, complete: true };
  }
  return { missing, removed, complete: state.done };
}

function reconciliationJobId(epoch: string | undefined, conceptId: string) {
  if (!epoch) return undefined;
  return `gr_${createHash("sha256")
    .update(`${epoch}\0${conceptId}`)
    .digest("hex")
    .slice(0, 20)}`;
}

function desiredConcept(concept: Concept) {
  const text = `${concept.frontmatter.title ?? concept.path}\n\n${concept.body}`;
  return { conceptId: concept.id, contentHash: graphContentHash(text) };
}

function graphContentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Meters the cognify LLM usage the worker reported for a graph-building call
 * into the ai_usage ledger (`graph_cognify`), attributed to the Collection's
 * assistant/org. Attribution lookups are best-effort like the write itself,
 * a missing Collection (deleted mid-flight) just skips the row.
 */
export async function meterGraphUsage(
  db: Db,
  collectionId: string,
  usage: GraphWorkerUsage
): Promise<void> {
  const row = await graphUsageInput(db, collectionId, usage);
  if (row) await meterUsage(db, [row]);
}

/** Resolve worker usage into the shared ledger row used by admission/settle. */
export async function graphUsageInput(
  db: Db,
  collectionId: string,
  usage: GraphWorkerUsage,
): Promise<AiUsageInput | null> {
  const collection = await db.getCollection(collectionId).catch(() => null);
  // Collections carry their Organization directly (PRD #726 contract); graph
  // work is a per-Collection cost, so it meters org-level with no assistant.
  if (!collection?.organizationId) return null;
  return {
    organizationId: collection.organizationId,
    assistantId: null,
    stage: "graph_cognify",
    provider: graphUsageProvider(usage),
    modelId: usage.modelId,
    // The worker runs on its own env-configured LLM key, the deployment
    // operator's credential, i.e. the funded bucket.
    credentialKind: "platform",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  };
}
