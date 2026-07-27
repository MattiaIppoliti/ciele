/**
 * Graph-sync jobs: keep each Knowledge Collection's derived Knowledge Graph in
 * step with its OKF Concepts (ADR-0017). Every create/update/delete of a
 * Concept enqueues one `graph_sync_concept` job (see `enqueueGraphSyncJob` in
 * `./jobs`) that pushes — or removes — that Concept's document on the graph
 * worker, tagged so a graph answer resolves back to Concept → Source. Deleting a
 * whole Collection (or the Assistant that owns it) instead enqueues one `purge`
 * job per Collection, which drops the entire dataset in a single worker call.
 *
 * OKF stays the system of record; this only projects it onto the graph. The
 * payload is rehydrated from the Db at run time (like `ingest_source`), so a
 * Concept edited between enqueue and run syncs its latest body.
 *
 * This module holds only the *performer* + payload shapes — deliberately no
 * import of `./jobs`, so the ledger (which imports `./ingest`, which enqueues
 * these) has no import cycle. The handler registration + enqueue live in
 * `./jobs`.
 */

import type { Db } from "@agent-hub/db";
import {
  type GraphWorkerUsage,
  graphUsageProvider,
  ingestConcepts,
  isGraphWorkerConfigured,
  purgeCollection,
  removeConcept,
} from "./graph-worker";
import { meterUsage } from "./usage";

export const GRAPH_SYNC_KIND = "graph_sync_concept" as const;

/**
 * A unit of graph-sync work carried on the `graph_sync_concept` ledger kind.
 * Two shapes share the kind because both run through the same handler + cron
 * backstop:
 *  - Concept-scoped (`ingest` / `remove`): (re)build or drop one Concept's graph
 *    document — needs `conceptId`.
 *  - Collection-scoped (`purge`): drop a whole Collection's dataset on Collection
 *    or Assistant delete — no Concept, so no `conceptId` (a per-Concept remove
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

/** A GraphSyncJob minus the fixed `kind` — the caller-supplied shape passed to
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
 * graph instead — keeping the index a faithful projection of the searchable
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
    // OKF to reconcile against — the Collection is gone.
    await purgeCollection(job.collectionId);
    return;
  }

  if (job.op === "remove") {
    await removeConcept(job.collectionId, job.conceptId);
    return;
  }

  const concept = await deps.db.getConcept(job.conceptId);
  if (!concept || concept.excluded) {
    // Gone or excluded from the search index since enqueue — mirror that on
    // the graph rather than leaving a stale document behind.
    await removeConcept(job.collectionId, job.conceptId);
    return;
  }

  const title = concept.frontmatter.title ?? concept.path;
  const { usage } = await ingestConcepts(job.collectionId, [
    {
      conceptId: concept.id,
      sourceId: concept.sourceId,
      // Title-prefixed like the pgvector index, so the graph sees the same text.
      text: `${title}\n\n${concept.body}`,
    },
  ]);
  if (usage) await meterGraphUsage(deps.db, job.collectionId, usage);
}

/**
 * Meters the cognify LLM usage the worker reported for a graph-building call
 * into the ai_usage ledger (`graph_cognify`), attributed to the Collection's
 * assistant/org. Attribution lookups are best-effort like the write itself —
 * a missing Collection (deleted mid-flight) just skips the row.
 */
export async function meterGraphUsage(
  db: Db,
  collectionId: string,
  usage: GraphWorkerUsage
): Promise<void> {
  const collection = await db.getCollection(collectionId).catch(() => null);
  const assistant = collection
    ? await db.getAssistant(collection.assistantId).catch(() => null)
    : null;
  if (!assistant) return;
  await meterUsage(db, [
    {
      organizationId: assistant.organizationId,
      assistantId: assistant.id,
      stage: "graph_cognify",
      provider: graphUsageProvider(usage),
      modelId: usage.modelId,
      // The worker runs on its own env-configured LLM key — the deployment
      // operator's credential, i.e. the funded bucket.
      credentialKind: "platform",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    },
  ]);
}
