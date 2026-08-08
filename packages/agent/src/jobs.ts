import type { BackgroundJob, BackgroundJobKind } from "@agent-hub/core";
import { thrownMessage } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";

import { getRuntimeHost } from "./host";
import { isGraphWorkerConfigured } from "./graph-worker";
import {
  GRAPH_SYNC_KIND,
  type GraphSyncJob,
  type GraphSyncJobInput,
  graphSyncJobFromRecord,
  performGraphSyncConcept,
} from "./graph-sync";
import { draftImprovementProposal } from "./improvement-proposal";
import { ingestSource } from "./ingest";
import { MEMORY_QUIET_MS, promoteConversationMemories } from "./memories";
import { runEntitySync } from "./entity-sync";

/**
 * The durable job ledger (ADR-0008), generic over `kind`: claim/lease,
 * backoff, retry and terminal-failure handling live HERE, once — a job type
 * contributes only a JobHandler (perform + optional terminal-failure hook)
 * registered in JOB_HANDLERS, mirroring the ACTION_HANDLERS and
 * website-crawler registries. Adding a job kind = one handler + one
 * BackgroundJobKind member; the lifecycle is never reimplemented.
 *
 * Payloads are JSON-serializable on purpose: today's accelerator is
 * in-process (`after()` — runs once the response is sent) with cron as the
 * durable backstop, and a queue-backed adapter can replace the enqueue
 * without touching handlers.
 *
 * Website crawls are Ingestion Jobs in domain language, but their current
 * execution path is separate from `background_jobs`: `beginWebsiteCrawl`
 * records the selected provider run, and `finalizeWebsiteCrawl` (polled by
 * the client and swept by cron) advances it through the shared Source
 * lifecycle. Folding them into this ledger is the planned contract step.
 */

export interface JobDeps {
  db: Db;
}

/** One job kind's contribution to the ledger: how to run a claimed job. */
export interface JobHandler {
  /** Executes one claimed job to completion; throwing triggers backoff/retry. */
  perform(record: BackgroundJob, deps: JobDeps): Promise<void>;
  /**
   * Runs once when attempts are exhausted (after the ledger marks the job
   * failed): surface the failure on the job's own domain object (Source
   * status, Alert, …).
   */
  onTerminalFailure?(
    record: BackgroundJob,
    deps: JobDeps,
    message: string
  ): Promise<void>;
}

export type JobOutcome = "succeeded" | "failed" | "retried";

export interface RunDueJobsResult {
  claimed: number;
  succeeded: number;
  failed: number;
  retried: number;
}

/** Linear backoff base: attempt N retries N minutes later. */
const RETRY_BACKOFF_MS = 60_000;

// ---------------------------------------------------------------------------
// ingest_source — runs the knowledge-ingestion pipeline (enrich → persist
// Concepts → embed) off the request path, tracked by the Source `status`
// lifecycle (`processing` → `ready`/`error`) the UI already renders.
// ---------------------------------------------------------------------------

export type IngestJob = {
  kind: "ingest_source";
  assistantId: string;
  collectionId: string;
  sourceId: string;
  rawText: string;
};

export type IngestJobDeps = JobDeps;

export type RunDueIngestJobsResult = RunDueJobsResult;

/** Executes one job to completion. Rehydrates everything from the Db so the
 *  payload stays serializable; any failure lands in the Source's `error`. */
async function performIngestJob(job: IngestJob, deps: IngestJobDeps): Promise<void> {
  const { db } = deps;
  const [assistant, source] = await Promise.all([
    db.getAssistant(job.assistantId),
    db.getSource(job.sourceId),
  ]);
  if (!assistant || !source) throw new Error("Not found");
  const connections = await db.listProviderConnections(assistant.organizationId);
  await ingestSource({
    db,
    assistantId: job.assistantId,
    collectionId: job.collectionId,
    source,
    rawText: job.rawText,
    connections,
  });

  const updated = await db.getSource(job.sourceId);
  if (updated?.status === "error") {
    throw new Error(updated.error || "Ingestion failed");
  }
}

export async function runIngestJob(job: IngestJob, deps: IngestJobDeps): Promise<void> {
  const { db } = deps;
  try {
    await performIngestJob(job, deps);
  } catch (error) {
    await db.updateSource(job.sourceId, {
      status: "error",
      error: thrownMessage(error, "Ingestion failed"),
    });
  }
}

function jobFromRecord(record: BackgroundJob): IngestJob {
  const payload = record.payload as Partial<IngestJob>;
  if (
    payload.kind !== "ingest_source" ||
    !payload.assistantId ||
    !payload.collectionId ||
    !payload.sourceId ||
    typeof payload.rawText !== "string"
  ) {
    throw new Error("Invalid ingest job payload");
  }
  return {
    kind: "ingest_source",
    assistantId: payload.assistantId,
    collectionId: payload.collectionId,
    sourceId: payload.sourceId,
    rawText: payload.rawText,
  };
}

const ingestSourceHandler: JobHandler = {
  async perform(record, deps) {
    await performIngestJob(jobFromRecord(record), deps);
  },
  async onTerminalFailure(record, deps, message) {
    const payloadSourceId = (record.payload as Partial<IngestJob>).sourceId;
    const sourceId = payloadSourceId ?? record.sourceId;
    if (sourceId) {
      await deps.db.updateSource(sourceId, { status: "error", error: message });
    }
  },
};

// ---------------------------------------------------------------------------
// graph_sync_concept — projects one OKF Concept onto its Collection's derived
// Knowledge Graph (ADR-0017). Inert when the graph worker is unconfigured.
// ---------------------------------------------------------------------------

const graphSyncHandler: JobHandler = {
  async perform(record, deps) {
    await performGraphSyncConcept(graphSyncJobFromRecord(record), deps);
  },
  // No onTerminalFailure: the graph is a derived index, so a permanently failed
  // sync leaves OKF (the record) intact and is recoverable by a backfill; the
  // ledger row's `failed` status is the operational signal.
};

// ---------------------------------------------------------------------------
// draft_improvement_proposal — drafts a Suggested Fix for an Improvement
// (ADR-0017 / #390). Best-effort: drafting failure leaves a "no proposal"
// state, so the handler never surfaces a terminal failure on the Improvement.
// ---------------------------------------------------------------------------

const DRAFT_PROPOSAL_KIND = "draft_improvement_proposal" as const;

type DraftProposalJob = {
  kind: typeof DRAFT_PROPOSAL_KIND;
  improvementId: string;
  messageId: string;
};

const draftProposalHandler: JobHandler = {
  async perform(record, deps) {
    const payload = record.payload as Partial<DraftProposalJob>;
    if (!payload.improvementId || !payload.messageId) {
      throw new Error("Invalid draft-proposal job payload");
    }
    await draftImprovementProposal({
      db: deps.db,
      improvementId: payload.improvementId,
      messageId: payload.messageId,
    });
  },
};

// ---------------------------------------------------------------------------
// promote_memories — extracts durable per-user facts from a Conversation that
// went quiet (#664). Best-effort: the handler itself resolves every gate
// (SSO subject, org toggle, budget, superseded-by-a-later-turn) into a no-op
// success, so only genuine model/db failures retry.
// ---------------------------------------------------------------------------

const PROMOTE_MEMORIES_KIND = "promote_memories" as const;

type PromoteMemoriesJob = {
  kind: typeof PROMOTE_MEMORIES_KIND;
  conversationId: string;
  organizationId: string;
};

const promoteMemoriesHandler: JobHandler = {
  async perform(record, deps) {
    const payload = record.payload as Partial<PromoteMemoriesJob>;
    if (!payload.conversationId || !payload.organizationId) {
      throw new Error("Invalid promote-memories job payload");
    }
    await promoteConversationMemories({
      db: deps.db,
      conversationId: payload.conversationId,
      organizationId: payload.organizationId,
      enqueuedAt: record.createdAt,
    });
  },
  // No onTerminalFailure: memories are additive and re-derivable — the next
  // conversation's job extracts again; the ledger row is the signal.
};

// ---------------------------------------------------------------------------
// sync_entity_records — one Record sync run for an Entity's REST/JSON source
// (#670). The handler itself no-ops duplicate sweep enqueues (cadence check)
// and missing configs; genuine fetch/map/db failures record a failed run,
// raise the Alert, and rethrow so the ledger applies backoff/retry.
// ---------------------------------------------------------------------------

const ENTITY_SYNC_KIND = "sync_entity_records" as const;

type EntitySyncJob = {
  kind: typeof ENTITY_SYNC_KIND;
  entityId: string;
  organizationId: string;
  /** "Sync now" bypasses the cadence check. */
  force?: boolean;
};

const entitySyncHandler: JobHandler = {
  async perform(record, deps) {
    const payload = record.payload as Partial<EntitySyncJob>;
    if (!payload.entityId || !payload.organizationId) {
      throw new Error("Invalid entity-sync job payload");
    }
    await runEntitySync({
      db: deps.db,
      entityId: payload.entityId,
      organizationId: payload.organizationId,
      force: payload.force ?? false,
    });
  },
  // No onTerminalFailure: every failed attempt already recorded a run and
  // raised the keyed Alert; the next successful run auto-resolves it.
};

// ---------------------------------------------------------------------------
// The registry + the generic lifecycle.
// ---------------------------------------------------------------------------

const JOB_HANDLERS: Record<BackgroundJobKind, JobHandler> = {
  ingest_source: ingestSourceHandler,
  graph_sync_concept: graphSyncHandler,
  draft_improvement_proposal: draftProposalHandler,
  promote_memories: promoteMemoriesHandler,
  sync_entity_records: entitySyncHandler,
};

async function runClaimedJob(
  record: BackgroundJob,
  deps: JobDeps,
  now: Date
): Promise<JobOutcome> {
  const handler = JOB_HANDLERS[record.kind];
  try {
    await handler.perform(record, deps);
    await deps.db.updateBackgroundJob(record.id, {
      status: "succeeded",
      error: "",
      lockedAt: null,
      lockedBy: null,
    });
    return "succeeded";
  } catch (error) {
    const message = thrownMessage(error, "Job failed");
    if (record.attempts >= record.maxAttempts) {
      await deps.db.updateBackgroundJob(record.id, {
        status: "failed",
        error: message,
        lockedAt: null,
        lockedBy: null,
      });
      await handler.onTerminalFailure?.(record, deps, message);
      return "failed";
    }

    const retryAt = new Date(now.getTime() + RETRY_BACKOFF_MS * record.attempts);
    await deps.db.updateBackgroundJob(record.id, {
      status: "queued",
      error: message,
      nextRunAt: retryAt.toISOString(),
      lockedAt: null,
      lockedBy: null,
    });
    return "retried";
  }
}

/**
 * Drains a bounded batch of due jobs per kind: atomically claims (leasing
 * against worker death via staleBefore) and runs each claimed job through its
 * registered handler. The one entry point every cron/accelerator tick uses.
 */
export async function runDueJobs(
  deps: JobDeps,
  options: {
    kinds?: BackgroundJobKind[];
    now?: Date;
    limit?: number;
    workerId?: string;
    staleAfterMs?: number;
  } = {}
): Promise<RunDueJobsResult> {
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? 15 * 60_000;
  const kinds =
    options.kinds ?? (Object.keys(JOB_HANDLERS) as BackgroundJobKind[]);

  const result: RunDueJobsResult = {
    claimed: 0,
    succeeded: 0,
    failed: 0,
    retried: 0,
  };
  for (const kind of kinds) {
    const claimed = await deps.db.claimBackgroundJobs({
      kind,
      workerId: options.workerId ?? `${kind}-${crypto.randomUUID()}`,
      now: now.toISOString(),
      staleBefore: new Date(now.getTime() - staleAfterMs).toISOString(),
      limit: options.limit ?? 5,
    });
    result.claimed += claimed.length;
    for (const record of claimed) {
      const outcome = await runClaimedJob(record, deps, now);
      result[outcome] += 1;
    }
  }
  return result;
}

export async function runDueIngestJobs(
  deps: IngestJobDeps,
  options: { now?: Date; limit?: number; workerId?: string; staleAfterMs?: number } = {}
): Promise<RunDueIngestJobsResult> {
  return runDueJobs(deps, { ...options, kinds: ["ingest_source"] });
}

/**
 * Durable adapter: creates the ledger row first, then asks the host to run the
 * drain after the response only as an accelerator. If the instance dies before
 * that work runs — or the host registered no scheduler at all — cron can still
 * claim the queued job later.
 */
export async function enqueueIngestJob(
  job: IngestJob,
  deps: IngestJobDeps
): Promise<void> {
  await deps.db.createBackgroundJob({
    kind: "ingest_source",
    sourceId: job.sourceId,
    payload: job,
  });
  getRuntimeHost().scheduleAfterResponse(() =>
    runDueJobs(deps, { kinds: ["ingest_source"], limit: 1 })
  );
}

/**
 * Enqueues a Suggested Fix drafting job for an Improvement raised from a flagged
 * message. Durable row first, host after-response accelerator, cron backstop. Best-effort
 * drafting means a failed job just leaves the Improvement without a proposal.
 */
export async function enqueueDraftProposalJob(
  job: { improvementId: string; messageId: string },
  deps: JobDeps
): Promise<void> {
  await deps.db.createBackgroundJob({
    kind: DRAFT_PROPOSAL_KIND,
    payload: { kind: DRAFT_PROPOSAL_KIND, ...job },
  });
  getRuntimeHost().scheduleAfterResponse(() =>
    runDueJobs(deps, { kinds: [DRAFT_PROPOSAL_KIND], limit: 1 })
  );
}

/** Drains due Suggested Fix drafting jobs — the cron backstop for the after-response accelerator. */
export async function runDueProposalJobs(
  deps: JobDeps,
  options: { now?: Date; limit?: number; workerId?: string; staleAfterMs?: number } = {}
): Promise<RunDueJobsResult> {
  return runDueJobs(deps, { ...options, kinds: [DRAFT_PROPOSAL_KIND] });
}

/**
 * Enqueues a memory-promotion job for a Conversation, due once the quiet
 * window elapses (#664). Every SSO turn enqueues one; the handler defers to
 * the freshest job when later messages exist, so re-enqueueing is cheap and
 * only the conversation's final turn extracts. Durable row first; the
 * `after()` accelerator also drains any older job whose window has elapsed.
 */
export async function enqueueMemoryPromotionJob(
  job: { conversationId: string; organizationId: string },
  deps: JobDeps,
  options: { delayMs?: number } = {}
): Promise<void> {
  await deps.db.createBackgroundJob({
    kind: PROMOTE_MEMORIES_KIND,
    payload: { kind: PROMOTE_MEMORIES_KIND, ...job },
    nextRunAt: new Date(
      Date.now() + (options.delayMs ?? MEMORY_QUIET_MS)
    ).toISOString(),
  });
  getRuntimeHost().scheduleAfterResponse(() =>
    runDueJobs(deps, { kinds: [PROMOTE_MEMORIES_KIND], limit: 5 })
  );
}

/** Drains due memory-promotion jobs — the cron backstop for `after()`. */
export async function runDueMemoryPromotionJobs(
  deps: JobDeps,
  options: { now?: Date; limit?: number; workerId?: string; staleAfterMs?: number } = {}
): Promise<RunDueJobsResult> {
  return runDueJobs(deps, { ...options, kinds: [PROMOTE_MEMORIES_KIND] });
}

/**
 * Enqueues one Entity sync run (#670). "Sync now" passes force: true to
 * bypass the cadence check; the cron sweep enqueues without it, so a
 * duplicate enqueue inside the window resolves to a handler no-op.
 */
export async function enqueueEntitySyncJob(
  job: { entityId: string; organizationId: string; force?: boolean },
  deps: JobDeps
): Promise<void> {
  await deps.db.createBackgroundJob({
    kind: ENTITY_SYNC_KIND,
    payload: { kind: ENTITY_SYNC_KIND, ...job },
    nextRunAt: new Date().toISOString(),
  });
  getRuntimeHost().scheduleAfterResponse(() =>
    runDueJobs(deps, { kinds: [ENTITY_SYNC_KIND], limit: 3 })
  );
}

/**
 * The cron sweep's enqueue source (#670): every configured sync whose
 * cadence has elapsed gets a job row. Rides the existing cron surface — no
 * new scheduler.
 */
export async function enqueueDueEntitySyncs(
  deps: JobDeps,
  now: Date = new Date()
): Promise<{ enqueued: number }> {
  const due = await deps.db.listDueEntitySyncConfigs(now.toISOString());
  for (const item of due) {
    await deps.db.createBackgroundJob({
      kind: ENTITY_SYNC_KIND,
      payload: { kind: ENTITY_SYNC_KIND, ...item },
      nextRunAt: now.toISOString(),
    });
  }
  return { enqueued: due.length };
}

/** Drains due Entity sync jobs — the cron backstop for `after()`. */
export async function runDueEntitySyncJobs(
  deps: JobDeps,
  options: { now?: Date; limit?: number; workerId?: string; staleAfterMs?: number } = {}
): Promise<RunDueJobsResult> {
  return runDueJobs(deps, { ...options, kinds: [ENTITY_SYNC_KIND] });
}

/** Drains due graph-sync jobs — the cron backstop for the host after-response accelerator. */
export async function runDueGraphSyncJobs(
  deps: JobDeps,
  options: { now?: Date; limit?: number; workerId?: string; staleAfterMs?: number } = {}
): Promise<RunDueJobsResult> {
  return runDueJobs(deps, { ...options, kinds: [GRAPH_SYNC_KIND] });
}

/**
 * Backfills an existing Knowledge Collection into its graph: enqueues an ingest
 * sync for every Concept. Idempotent — re-running replaces each graph document
 * (the worker deletes-then-adds by conceptId), and excluded/deleted Concepts
 * resolve to removes in the handler. Inert (enqueues nothing) without a worker.
 */
export async function backfillCollectionToGraph(
  collectionId: string,
  deps: JobDeps
): Promise<{ enqueued: number }> {
  if (!isGraphWorkerConfigured()) return { enqueued: 0 };
  const concepts = await deps.db.listConcepts(collectionId);
  for (const concept of concepts) {
    await enqueueGraphSyncJob({ op: "ingest", collectionId, conceptId: concept.id }, deps);
  }
  return { enqueued: concepts.length };
}

/**
 * Enqueues a graph-sync job for one Concept. **Inert when the graph worker is
 * unconfigured** — it creates no ledger row and returns, so an environment
 * without a sidecar never accrues queued/failed graph jobs (an acceptance
 * criterion). Mirrors `enqueueIngestJob`: durable row first, the host after-response scheduler only as an accelerator, cron as the backstop.
 */
export async function enqueueGraphSyncJob(
  job: GraphSyncJobInput,
  deps: JobDeps
): Promise<void> {
  if (!isGraphWorkerConfigured()) return;
  const payload = { kind: GRAPH_SYNC_KIND, ...job } as GraphSyncJob;
  await deps.db.createBackgroundJob({
    kind: GRAPH_SYNC_KIND,
    sourceId: null,
    payload,
  });
  getRuntimeHost().scheduleAfterResponse(() =>
    runDueJobs(deps, { kinds: [GRAPH_SYNC_KIND], limit: 1 })
  );
}
