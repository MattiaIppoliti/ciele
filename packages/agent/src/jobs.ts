import type { BackgroundJob, BackgroundJobKind } from "@agent-hub/core";
import { thrownMessage } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { createHash } from "node:crypto";

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
import { ingestSource, type SourceConceptDraft } from "./ingest";
import { MEMORY_QUIET_MS, promoteConversationMemories } from "./memories";
import { distillAgentLearning } from "./agent-learnings";
import { runEntitySync } from "./entity-sync";
import {
  type ApplicationConnectorRegistry,
} from "./application-connectors";
import { APPLICATION_CONNECTORS } from "./application-provider-connectors";
import { syncApplicationImport } from "./application-sync";
import {
  deliverReviewRequestHandler,
  resumeReviewedConversationHandler,
} from "./review-runtime";
import { resumeWebhookConversationHandler } from "./webhook-runtime";

/**
 * The durable job ledger (ADR-0008), generic over `kind`: claim/lease,
 * backoff, retry and terminal-failure handling live HERE, once, a job type
 * contributes only a JobHandler (perform + optional terminal-failure hook)
 * registered in JOB_HANDLERS, mirroring the ACTION_HANDLERS and
 * website-crawler registries. Adding a job kind = one handler + one
 * BackgroundJobKind member; the lifecycle is never reimplemented.
 *
 * Payloads are JSON-serializable on purpose: today's accelerator is
 * in-process (`after()`, runs once the response is sent) with cron as the
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
  applicationConnectors?: ApplicationConnectorRegistry;
}

/** One job kind's contribution to the ledger: how to run a claimed job. */
export interface JobHandler {
  /** Executes one claimed job to completion; throwing triggers backoff/retry. */
  perform(record: BackgroundJob, deps: JobDeps): Promise<void>;
  settleSuccess?(record: BackgroundJob, deps: JobDeps, now: Date): Promise<boolean>;
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

export type JobOutcome = "succeeded" | "failed" | "retried" | "superseded";

export interface RunDueJobsResult {
  claimed: number;
  succeeded: number;
  failed: number;
  retried: number;
  /** Work finished after another worker reclaimed its lease. */
  superseded: number;
}

/** Linear backoff base: attempt N retries N minutes later. */
const RETRY_BACKOFF_MS = 60_000;

// ---------------------------------------------------------------------------
// ingest_source, runs the knowledge-ingestion pipeline (enrich → persist
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

type StoredIngestJob =
  | (Omit<IngestJob, "rawText"> & { payloadVersion: number })
  | (IngestJob & { schemaLagFallback?: boolean });

export type IngestJobDeps = JobDeps;

export type RunDueIngestJobsResult = RunDueJobsResult;

/** Executes one job to completion. Rehydrates everything from the Db so the
 *  payload stays serializable; any failure lands in the Source's `error`. */
async function performIngest(
  job: Omit<IngestJob, "rawText"> & {
    payloadVersion?: number;
    jobId?: string;
    leaseToken?: string;
  },
  rawText: string,
  deps: IngestJobDeps,
  renewLease?: () => Promise<boolean>,
  drafts?: SourceConceptDraft[] | null
): Promise<void> {
  const { db } = deps;
  const [assistant, source] = await Promise.all([
    db.getAssistant(job.assistantId),
    db.getSource(job.sourceId),
  ]);
  if (!assistant || !source) throw new Error("Not found");
  const connections = await db.listProviderConnections(assistant.organizationId);
  const completed = await ingestSource({
    db,
    assistantId: job.assistantId,
    collectionId: job.collectionId,
    source,
    rawText,
    connections,
    renewLease,
    drafts,
    initializeAttempt:
      job.payloadVersion === undefined
        ? undefined
        : (nextDrafts) =>
            db.initializeSourceIngestAttempt({
              jobId: job.jobId!,
              leaseToken: job.leaseToken!,
              sourceId: job.sourceId,
              version: job.payloadVersion!,
              drafts: nextDrafts,
            }),
    persistCursor:
      job.payloadVersion === undefined
        ? undefined
        : (generationId, cursor) =>
            db.checkpointSourceIngestCursor({
              jobId: job.jobId!,
              leaseToken: job.leaseToken!,
              sourceId: job.sourceId,
              version: job.payloadVersion!,
              generationId,
              cursor,
            }),
    commitGeneration:
      job.payloadVersion === undefined
        ? undefined
        : (generation) =>
            db.commitSourceIngestGeneration({
              jobId: job.jobId!,
              leaseToken: job.leaseToken!,
              version: job.payloadVersion!,
              ...generation,
            }),
  });

  if (!completed) {
    const updated = await db.getSource(job.sourceId);
    throw new Error(updated?.error || "Ingest job did not complete");
  }

  const updated = await db.getSource(job.sourceId);
  if (updated?.status === "error") {
    throw new Error(updated.error || "Ingestion failed");
  }
}

export async function runIngestJob(job: IngestJob, deps: IngestJobDeps): Promise<void> {
  const { db } = deps;
  try {
    await performIngest(job, job.rawText, deps);
  } catch (error) {
    await db.updateSource(job.sourceId, {
      status: "error",
      error: thrownMessage(error, "Ingestion failed"),
    });
  }
}

function jobFromRecord(record: BackgroundJob): StoredIngestJob {
  const payload = record.payload as Partial<IngestJob> & {
    payloadVersion?: number;
    schemaLagFallback?: boolean;
  };
  if (
    payload.kind !== "ingest_source" ||
    !payload.assistantId ||
    !payload.collectionId ||
    !payload.sourceId ||
    (typeof payload.payloadVersion !== "number" && typeof payload.rawText !== "string")
  ) {
    throw new Error("Invalid ingest job payload");
  }
  return {
    kind: "ingest_source",
    assistantId: payload.assistantId,
    collectionId: payload.collectionId,
    sourceId: payload.sourceId,
    ...(typeof payload.payloadVersion === "number"
      ? { payloadVersion: payload.payloadVersion }
      : {
          rawText: payload.rawText!,
          schemaLagFallback: payload.schemaLagFallback === true,
        }),
  } as StoredIngestJob;
}

async function legacyApplicationIngestIsCurrent(
  db: Db,
  job: IngestJob
): Promise<boolean> {
  const source = await db.getSource(job.sourceId);
  if (source?.kind !== "application") return true;
  const importId = source.config.applicationImportId;
  if (typeof importId !== "string") return true;
  const mapping = (await db.listApplicationSources(importId)).find(
    (candidate) => candidate.sourceId === source.id
  );
  if (!mapping) return true;
  const contentHash = createHash("sha256")
    .update(source.name)
    .update("\0")
    .update(job.rawText)
    .digest("hex");
  return mapping.contentHash === contentHash;
}

const ingestSourceHandler: JobHandler = {
  async perform(record, deps) {
    const job = jobFromRecord(record);
    const renewLease = () =>
      deps.db.renewBackgroundJobLease({
        id: record.id,
        leaseToken: record.leaseToken!,
        now: new Date().toISOString(),
      });
    if ("rawText" in job) {
      if (job.schemaLagFallback) {
        await performIngest(job, job.rawText, deps, renewLease);
        return;
      }
      if (!(await legacyApplicationIngestIsCurrent(deps.db, job))) return;
      const payloadVersion = await deps.db.upgradeLegacySourceIngestJob({
        jobId: record.id,
        leaseToken: record.leaseToken!,
        assistantId: job.assistantId,
        collectionId: job.collectionId,
        sourceId: job.sourceId,
        rawText: job.rawText,
        now: new Date().toISOString(),
      });
      if (payloadVersion === "schema_lag") {
        await performIngest(job, job.rawText, deps, renewLease);
        return;
      }
      if (payloadVersion === null) return;
      await performIngest(
        {
          ...job,
          jobId: record.id,
          leaseToken: record.leaseToken!,
          payloadVersion,
        },
        job.rawText,
        deps,
        renewLease
      );
      return;
    }
    const payload = await deps.db.getSourceIngestPayload(
      job.sourceId,
      job.payloadVersion
    );
    if (!payload) throw new Error("Ingest payload not found");
    if (!record.leaseToken) throw new Error("Claimed ingest job has no lease token");
    await performIngest(
      { ...job, jobId: record.id, leaseToken: record.leaseToken },
      payload.rawText,
      deps,
      renewLease,
      payload.drafts
    );
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
// graph_sync_concept, projects one OKF Concept onto its Collection's derived
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
// draft_improvement_proposal, drafts a Suggested Fix for an Improvement
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
// promote_memories, extracts durable per-user facts from a Conversation that
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
  // No onTerminalFailure: memories are additive and re-derivable, the next
  // conversation's job extracts again; the ledger row is the signal.
};

// ---------------------------------------------------------------------------
// distill_agent_memory, appends one distilled learning to a Teammate's Agent
// layer after a turn (#771). Modelled on promote_memories: durable row first,
// `after()` accelerates it, cron is the backstop. The handler resolves every
// gate (retired Teammate, no exchange, no credential, nothing worth keeping)
// into a no-op success, so only real model/db failures retry.
// ---------------------------------------------------------------------------

const DISTILL_AGENT_MEMORY_KIND = "distill_agent_memory" as const;

type DistillAgentMemoryJob = {
  kind: typeof DISTILL_AGENT_MEMORY_KIND;
  organizationId: string;
  teammateId: string;
  conversationId: string;
};

const distillAgentMemoryHandler: JobHandler = {
  async perform(record, deps) {
    const payload = record.payload as Partial<DistillAgentMemoryJob>;
    if (!payload.organizationId || !payload.teammateId || !payload.conversationId) {
      throw new Error("Invalid distill-agent-memory job payload");
    }
    await distillAgentLearning({
      db: deps.db,
      organizationId: payload.organizationId,
      teammateId: payload.teammateId,
      conversationId: payload.conversationId,
    });
  },
  // No onTerminalFailure: a learning is additive and the next turn distils
  // again. Losing one is a note the Teammate does not have, not a broken state.
};

/**
 * Queue the end-of-turn distillation. Delayed like memory promotion, so a
 * fast back-and-forth distils the exchange once rather than once per message.
 */
export async function enqueueAgentMemoryJob(
  job: { organizationId: string; teammateId: string; conversationId: string },
  deps: JobDeps,
  options: { delayMs?: number } = {}
): Promise<void> {
  await deps.db.createBackgroundJob({
    organizationId: job.organizationId,
    kind: DISTILL_AGENT_MEMORY_KIND,
    payload: { kind: DISTILL_AGENT_MEMORY_KIND, ...job },
    nextRunAt: new Date(
      Date.now() + (options.delayMs ?? MEMORY_QUIET_MS)
    ).toISOString(),
  });
  getRuntimeHost().scheduleAfterResponse(() =>
    runDueJobs(deps, { kinds: [DISTILL_AGENT_MEMORY_KIND], limit: 5 })
  );
}

/** Drains due agent-memory jobs, the cron backstop for `after()`. */
export async function runDueAgentMemoryJobs(
  deps: JobDeps,
  options: { now?: Date; limit?: number; workerId?: string; staleAfterMs?: number } = {}
): Promise<RunDueJobsResult> {
  return runDueJobs(deps, { ...options, kinds: [DISTILL_AGENT_MEMORY_KIND] });
}

// ---------------------------------------------------------------------------
// sync_entity_records, one Record sync run for an Entity's REST/JSON source
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
// sync_application_import, materializes external read-only content as Sources.
// Provider pagination/normalization belongs to the Connector; this handler
// contributes the operation to the one durable ledger lifecycle.
// ---------------------------------------------------------------------------

const APPLICATION_SYNC_KIND = "sync_application_import" as const;

function applicationSyncConcurrencyLimit(): number {
  const configured = Number(process.env.APPLICATION_IMPORT_MAX_CONCURRENT ?? 3);
  return Number.isInteger(configured) ? Math.max(1, Math.min(configured, 20)) : 3;
}

type ApplicationSyncJob = {
  kind: typeof APPLICATION_SYNC_KIND;
  importId: string;
  organizationId: string;
};

const applicationSyncHandler: JobHandler = {
  async perform(record, deps) {
    const payload = record.payload as Partial<ApplicationSyncJob>;
    if (!payload.importId || !payload.organizationId) {
      throw new Error("Invalid application-sync job payload");
    }
    const applicationImport = await deps.db.getApplicationImport(payload.importId);
    if (!applicationImport?.enabled) return;
    let lastHeartbeatAt = 0;
    await syncApplicationImport({
      db: deps.db,
      importId: payload.importId,
      organizationId: payload.organizationId,
      connectors: deps.applicationConnectors ?? APPLICATION_CONNECTORS,
      onProgress: async () => {
        const now = Date.now();
        if (now - lastHeartbeatAt < 30_000) return;
        lastHeartbeatAt = now;
        const renewed = await deps.db.renewBackgroundJobLease({
          id: record.id,
          leaseToken: record.leaseToken!,
          now: new Date(now).toISOString(),
        });
        if (!renewed) {
          throw Object.assign(new Error("Application sync lease was lost"), {
            retryable: false,
          });
        }
        const currentImport = await deps.db.getApplicationImport(payload.importId!);
        if (!currentImport?.enabled) {
          throw Object.assign(new Error("Application Import is paused"), {
            name: "ApplicationImportPausedError",
            retryable: false,
          });
        }
      },
    });
  },
  async settleSuccess(record, deps, now) {
    const payload = record.payload as Partial<ApplicationSyncJob>;
    if (!payload.importId || !payload.organizationId || !record.leaseToken) {
      return false;
    }
    return deps.db.settleApplicationSyncJobSuccess({
      id: record.id,
      leaseToken: record.leaseToken,
      importId: payload.importId,
      organizationId: payload.organizationId,
      now: now.toISOString(),
      maxConcurrent: applicationSyncConcurrencyLimit(),
    });
  },
};

// ---------------------------------------------------------------------------
// The registry + the generic lifecycle.
// ---------------------------------------------------------------------------

const JOB_HANDLERS: Record<BackgroundJobKind, JobHandler> = {
  ingest_source: ingestSourceHandler,
  graph_sync_concept: graphSyncHandler,
  draft_improvement_proposal: draftProposalHandler,
  promote_memories: promoteMemoriesHandler,
  distill_agent_memory: distillAgentMemoryHandler,
  sync_entity_records: entitySyncHandler,
  sync_application_import: applicationSyncHandler,
  // Human review (#841): delivery, then continuation or halt.
  deliver_review_request: deliverReviewRequestHandler,
  resume_reviewed_conversation: resumeReviewedConversationHandler,
  // The callback gate (#842): continuation or halt. No delivery twin, the
  // subscribe call runs inline in the action.
  resume_webhook_conversation: resumeWebhookConversationHandler,
};

async function runClaimedJob(
  record: BackgroundJob,
  deps: JobDeps,
  now: Date
): Promise<JobOutcome> {
  const handler = JOB_HANDLERS[record.kind];
  if (!record.leaseToken) throw new Error("Claimed job has no lease token");
  try {
    await handler.perform(record, deps);
    const settled = handler.settleSuccess
      ? await handler.settleSuccess(record, deps, now)
      : await deps.db.settleBackgroundJob({
          id: record.id,
          leaseToken: record.leaseToken,
          now: now.toISOString(),
          outcome: { status: "succeeded" },
        });
    if (!settled) return "superseded";
    return "succeeded";
  } catch (error) {
    const message = thrownMessage(error, "Job failed");
    const retryable =
      typeof error !== "object" ||
      error === null ||
      !("retryable" in error) ||
      error.retryable !== false;
    if (!retryable || record.attempts >= record.maxAttempts) {
      // Cleanup must complete before the durable terminal transition. If the
      // hook fails, the running lease eventually becomes eligible for the
      // retryable terminal-cleanup claim path.
      await handler.onTerminalFailure?.(record, deps, message);
      const settled = await deps.db.settleBackgroundJob({
        id: record.id,
        leaseToken: record.leaseToken,
        now: now.toISOString(),
        outcome: { status: "failed", error: message },
      });
      if (!settled) return "superseded";
      return "failed";
    }

    const requestedRetryMs =
      typeof error === "object" &&
      error !== null &&
      "retryAfterMs" in error &&
      typeof error.retryAfterMs === "number"
        ? error.retryAfterMs
        : 0;
    const retryAt = new Date(
      now.getTime() +
        Math.max(RETRY_BACKOFF_MS * record.attempts, requestedRetryMs)
    );
    const settled = await deps.db.settleBackgroundJob({
      id: record.id,
      leaseToken: record.leaseToken,
      now: now.toISOString(),
      outcome: {
        status: "queued",
        error: message,
        nextRunAt: retryAt.toISOString(),
      },
    });
    return settled ? "retried" : "superseded";
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
    superseded: 0,
  };
  for (const kind of kinds) {
    const limit = options.limit ?? 5;
    const workerId = options.workerId ?? `${kind}-${crypto.randomUUID()}`;
    const staleBefore = new Date(now.getTime() - staleAfterMs).toISOString();
    const terminal =
      typeof deps.db.claimTerminalBackgroundJobs === "function"
        ? await deps.db.claimTerminalBackgroundJobs({
            kind,
            workerId,
            now: now.toISOString(),
            staleBefore,
            limit,
          })
        : [];
    for (const record of terminal) {
      if (!record.leaseToken) throw new Error("Terminal cleanup job has no lease token");
      const message = record.error || "Worker lease expired after final attempt";
      try {
        await JOB_HANDLERS[record.kind].onTerminalFailure?.(record, deps, message);
        const settled = await deps.db.settleBackgroundJob({
          id: record.id,
          leaseToken: record.leaseToken,
          now: now.toISOString(),
          outcome: { status: "failed", error: message },
        });
        result[settled ? "failed" : "superseded"] += 1;
      } catch (error) {
        // Keep the row running under this lease. A later drain reclaims it
        // after staleAfterMs and retries cleanup before terminal settlement.
        console.error("[jobs] terminal cleanup failed:", error);
        result.retried += 1;
      }
    }
    const remaining = Math.max(limit - terminal.length, 0);
    if (remaining === 0) continue;
    const claimed = await deps.db.claimBackgroundJobs({
      kind,
      workerId,
      now: now.toISOString(),
      staleBefore,
      limit: remaining,
    });
    for (const record of claimed) {
      result.claimed += 1;
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
 * that work runs, or the host registered no scheduler at all, cron can still
 * claim the queued job later.
 */
export async function enqueueIngestJob(
  job: IngestJob,
  deps: IngestJobDeps
): Promise<void> {
  await deps.db.stageSourceIngestJob(job);
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
  const message = await deps.db.getMessage(job.messageId);
  const conversation = message
    ? await deps.db.getConversation(message.conversationId)
    : null;
  const owner = conversation?.assistantId
    ? await deps.db.getAssistant(conversation.assistantId)
    : conversation?.teammateId
      ? await deps.db.table("teammates").get(conversation.teammateId)
      : null;
  if (!owner) throw new Error("Draft proposal organization not found");
  await deps.db.createBackgroundJob({
    organizationId: owner.organizationId,
    kind: DRAFT_PROPOSAL_KIND,
    payload: { kind: DRAFT_PROPOSAL_KIND, ...job },
  });
  getRuntimeHost().scheduleAfterResponse(() =>
    runDueJobs(deps, { kinds: [DRAFT_PROPOSAL_KIND], limit: 1 })
  );
}

/** Drains due Suggested Fix drafting jobs, the cron backstop for the after-response accelerator. */
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
    organizationId: job.organizationId,
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

/** Drains due memory-promotion jobs, the cron backstop for `after()`. */
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
    organizationId: job.organizationId,
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
 * cadence has elapsed gets a job row. Rides the existing cron surface, no
 * new scheduler.
 */
export async function enqueueDueEntitySyncs(
  deps: JobDeps,
  now: Date = new Date()
): Promise<{ enqueued: number }> {
  const due = await deps.db.listDueEntitySyncConfigs(now.toISOString());
  for (const item of due) {
    await deps.db.createBackgroundJob({
      organizationId: item.organizationId,
      kind: ENTITY_SYNC_KIND,
      payload: { kind: ENTITY_SYNC_KIND, ...item },
      nextRunAt: now.toISOString(),
    });
  }
  return { enqueued: due.length };
}

/** Drains due Entity sync jobs, the cron backstop for `after()`. */
export async function runDueEntitySyncJobs(
  deps: JobDeps,
  options: { now?: Date; limit?: number; workerId?: string; staleAfterMs?: number } = {}
): Promise<RunDueJobsResult> {
  return runDueJobs(deps, { ...options, kinds: [ENTITY_SYNC_KIND] });
}

/** Enqueues one manual or scheduled Application Import sync. */
export async function enqueueApplicationSyncJob(
  job: { importId: string; organizationId: string },
  deps: JobDeps
): Promise<boolean> {
  const nextRunAt = new Date().toISOString();
  const enqueued = await deps.db.createApplicationSyncJobIfAbsent({
    ...job,
    nextRunAt,
    maxConcurrent: applicationSyncConcurrencyLimit(),
  });
  if (!enqueued) {
    const applicationImport = await deps.db.getApplicationImport(job.importId);
    if (applicationImport?.enabled) {
      await deps.db.updateApplicationImport(job.importId, {
        status: "syncing",
        nextSyncAt: nextRunAt,
      });
    }
  }
  getRuntimeHost().scheduleAfterResponse(() =>
    runDueJobs(deps, { kinds: [APPLICATION_SYNC_KIND], limit: 3 })
  );
  return enqueued;
}

/** Enqueues every daily Application Import whose next run is due. */
export async function enqueueDueApplicationSyncs(
  deps: JobDeps,
  now: Date = new Date(),
  limit = 50
): Promise<{ enqueued: number }> {
  const due = await deps.db.listDueApplicationImports(now.toISOString(), limit);
  let enqueued = 0;
  for (const applicationImport of due) {
    if (await deps.db.createApplicationSyncJobIfAbsent({
      importId: applicationImport.id,
      organizationId: applicationImport.organizationId,
      nextRunAt: now.toISOString(),
      maxConcurrent: applicationSyncConcurrencyLimit(),
    })) {
      enqueued += 1;
    }
  }
  return { enqueued };
}

/** Drains due Application Import jobs through the shared claim/retry ledger. */
export async function runDueApplicationSyncJobs(
  deps: JobDeps,
  options: { now?: Date; limit?: number; workerId?: string; staleAfterMs?: number } = {}
): Promise<RunDueJobsResult> {
  return runDueJobs(deps, { ...options, kinds: [APPLICATION_SYNC_KIND] });
}

/** Drains due graph-sync jobs, the cron backstop for the host after-response accelerator. */
export async function runDueGraphSyncJobs(
  deps: JobDeps,
  options: { now?: Date; limit?: number; workerId?: string; staleAfterMs?: number } = {}
): Promise<RunDueJobsResult> {
  return runDueJobs(deps, { ...options, kinds: [GRAPH_SYNC_KIND] });
}

/**
 * Backfills an existing Knowledge Collection into its graph: enqueues an ingest
 * sync for every Concept. Idempotent, re-running replaces each graph document
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
 * unconfigured**, it creates no ledger row and returns, so an environment
 * without a sidecar never accrues queued/failed graph jobs (an acceptance
 * criterion). Mirrors `enqueueIngestJob`: durable row first, the host after-response scheduler only as an accelerator, cron as the backstop.
 */
export async function enqueueGraphSyncJob(
  job: GraphSyncJobInput,
  deps: JobDeps,
  options: { organizationId?: string; jobId?: string } = {}
): Promise<void> {
  if (!isGraphWorkerConfigured()) return;
  const collection = options.organizationId
    ? null
    : await deps.db.getCollection(job.collectionId);
  const organizationId = options.organizationId ?? collection?.organizationId;
  if (!organizationId) throw new Error("Graph job collection not found");
  const payload = { kind: GRAPH_SYNC_KIND, ...job } as GraphSyncJob;
  await deps.db.createBackgroundJob({
    ...(options.jobId ? { id: options.jobId } : {}),
    organizationId,
    kind: GRAPH_SYNC_KIND,
    sourceId: null,
    payload,
  });
  getRuntimeHost().scheduleAfterResponse(() =>
    runDueJobs(deps, { kinds: [GRAPH_SYNC_KIND], limit: 1 })
  );
}
