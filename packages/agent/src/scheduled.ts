/**
 * The scheduled drains: one function per cron tick.
 *
 * These used to live inside `apps/web`'s cron route handlers, which meant the
 * *policy* of a scheduled run (how large a batch to claim, how long a lease is
 * stale, what a partial failure reports) sat in a Next.js route while the
 * pipeline it drives lived here. Now the route is a pure adapter, cron auth in,
 * `Response.json` out, and each tick's behavior is testable without a request.
 *
 * Both return the tick's report as the exact object the cron endpoint serializes,
 * so the operational payload an admin reads in Vercel's cron log is pinned by
 * this package's tests rather than by a route.
 */

import type { RetentionSweepEventInput, SourceStatus } from "@agent-hub/core";
import { thrownMessage } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";

import { runCompostPass } from "./compost";
import { runDueGoalEvals } from "./goal-runner";
import {
  CRAWL_FINALIZE_LEASE_MS,
  finalizeWebsiteCrawl,
  restartWebsiteCrawl,
} from "./ingest";
import { runTrustMaterialization } from "./trust";
import { drainTurnEffects } from "./effects";
import { runDueAnswerVerifications } from "./verifier";
import {
  enqueueDueEntitySyncs,
  enqueueDueApplicationSyncs,
  type RunDueJobsResult,
  runDueEntitySyncJobs,
  runDueApplicationSyncJobs,
  runDueGraphSyncJobs,
  runDueIngestJobs,
  runDueAgentMemoryJobs,
  runDueMemoryPromotionJobs,
  runDueProposalJobs,
} from "./jobs";

export interface ScheduledDeps {
  db: Db;
}

/**
 * Each claimed Source triggers a full site crawl. Keep each run deliberately
 * small so one tick never fans out across every due Source at once; the rest
 * stay due and are picked up by the next tick.
 */
export const RECRAWL_SWEEP_BATCH_SIZE = 5;

/**
 * Finalization can fetch and ingest a complete website. Keep each tick
 * deliberately small so one slow batch never fans out across every pending
 * crawl; remaining Sources stay `processing` for the next tick.
 */
export const CRAWL_FINALIZE_BATCH_SIZE = 5;

/**
 * Lease-holder prefix for a finalize tick. Each of the four claims this tick
 * makes derives its worker id from this, so a stuck lease in the ledger is
 * traceable to the cron that took it.
 */
const FINALIZE_WORKER_ID = "cron-finalize-crawls";

/** One Source's outcome in a sweep tick: crawl started, or why it did not. */
export type SweptRecrawlResult =
  | { sourceId: string; status: "processing" }
  | { sourceId: string; status: "skipped"; message: string }
  | { sourceId: string; status: "error"; message: string };

export interface SweepDueRecrawlsReport {
  recrawls: { swept: number; launched: number; results: SweptRecrawlResult[] };
}

/**
 * Scheduled re-crawl sweep (#36). Turns each Website Source's per-site cadence
 * (daily / weekly / monthly; "never" opts out) into hands-off refreshes.
 *
 * Atomically claims a bounded, oldest-crawled-first batch of due Sources across
 * all orgs, then runs each through the *same* provider resolution + crawl-start
 * pipeline as a manual re-crawl (`restartWebsiteCrawl`), scheduling decides
 * only *when*, never *how*. Claiming flips a due Source to `processing`, so a
 * Source already crawling is skipped and running the sweep twice inside a
 * window never starts a duplicate remote run. The previous ready Concepts stay
 * live until the replacement crawl finalizes with usable pages, so a failed
 * refresh keeps the existing knowledge. One Source failing to start never
 * aborts the rest of the batch; crawl failures surface through the
 * crawl-failure Alert the pipeline already raises on finalize.
 */
export async function sweepDueRecrawls(
  deps: ScheduledDeps,
  options: { now?: Date; limit?: number } = {}
): Promise<SweepDueRecrawlsReport> {
  const { db } = deps;
  const now = options.now ?? new Date();
  const due = await db.claimDueRecrawlSources({
    now: now.toISOString(),
    limit: options.limit ?? RECRAWL_SWEEP_BATCH_SIZE,
  });

  const results = await Promise.all(
    due.map(async ({ sourceId }): Promise<SweptRecrawlResult> => {
      try {
        const result = await restartWebsiteCrawl({ db, sourceId });
        // A re-crawl refused for budget (#510) is not a run and not a failure:
        // report it as skipped so a sweep never claims work it did not start.
        return result.started
          ? { sourceId, status: "processing" as const }
          : { sourceId, status: "skipped" as const, message: result.reason };
      } catch (error) {
        return {
          sourceId,
          status: "error" as const,
          message: thrownMessage(error, "re-crawl failed"),
        };
      }
    })
  );

  const launched = results.filter((r) => r.status === "processing").length;
  return { recrawls: { swept: due.length, launched, results } };
}

/** One Source's outcome in a finalize tick: the reached status, or why it threw. */
export type FinalizedCrawlResult =
  | { sourceId: string; status: SourceStatus }
  | { sourceId: string; status: "error"; message: string };

export interface FinalizeDueCrawlsReport {
  effects: Awaited<ReturnType<typeof drainTurnEffects>>;
  jobs: RunDueJobsResult;
  graphSync: RunDueJobsResult;
  proposals: RunDueJobsResult;
  memories: RunDueJobsResult;
  /** Teammate Agent-layer distillation (#771). */
  agentMemories: RunDueJobsResult;
  entitySyncs: RunDueJobsResult & { enqueued: number };
  applicationSyncs: RunDueJobsResult & { enqueued: number };
  crawls: { swept: number; settled: number; results: FinalizedCrawlResult[] };
  backlog: Awaited<ReturnType<Db["getWorkQueueHealth"]>>;
  ledgerSweep: Awaited<ReturnType<Db["sweepRuntimeLedgers"]>>;
}

const QUEUE_AGE_ALERT_MS = 15 * 60 * 1000;

function alertOnOldQueueWork(
  backlog: Awaited<ReturnType<Db["getWorkQueueHealth"]>>,
  now: Date
): void {
  const overdue = [
    ...Object.entries(backlog.backgroundJobs).map(([kind, state]) => ({
      queue: `background:${kind}`,
      ...state,
    })),
    { queue: "turn-effects", ...backlog.turnEffects },
  ]
    .filter(
      (state) =>
        state.due > 0 &&
        state.oldestDueAt !== null &&
        now.getTime() - new Date(state.oldestDueAt).getTime() >= QUEUE_AGE_ALERT_MS
    )
    .map((state) => ({
      queue: state.queue,
      due: state.due,
      oldestDueAt: state.oldestDueAt,
      ageSeconds: Math.floor(
        (now.getTime() - new Date(state.oldestDueAt!).getTime()) / 1000
      ),
    }));
  if (overdue.length > 0) {
    // Deployment error-log alerts are the cross-tenant operational channel;
    // product health alerts remain organization-scoped and cannot represent
    // this service-wide queue SLO without leaking another tenant's backlog.
    console.error("[runtime] durable queue age SLO breached", { overdue });
  }
}

/**
 * Background safety-net tick for website crawls and the durable job ledger.
 *
 * The Knowledge UI polls in-flight crawls while it is open; an admin who closes
 * the tab mid-crawl would otherwise leave the Source on `processing`. This drains
 * the ledger (ingest, graph-sync, Suggested Fix drafting, each the cron backstop
 * for the host's after-response accelerator), then atomically claims one bounded,
 * least-recently-attempted batch of `processing` crawls across all orgs and
 * finalizes any whose provider run has finished. A finalize failure is reported
 * per Source and never aborts the batch.
 */
export async function finalizeDueCrawls(
  deps: ScheduledDeps,
  options: { now?: Date; limit?: number; queuePasses?: number } = {}
): Promise<FinalizeDueCrawlsReport> {
  const { db } = deps;
  const workerId = FINALIZE_WORKER_ID;
  const observedAt = options.now ?? new Date();
  const emptyBacklog = () => ({
    backgroundJobs: {},
    turnEffects: { due: 0, oldestDueAt: null },
  });
  // Observe age before claiming. A successful drain must not erase the fact
  // that durable work already missed its delivery SLO.
  const backlogBeforeDrain = await db
    .getWorkQueueHealth(observedAt.toISOString())
    .catch(emptyBacklog);
  alertOnOldQueueWork(backlogBeforeDrain, observedAt);
  const [entityEnqueued, applicationEnqueued] = await Promise.all([
    enqueueDueEntitySyncs({ db }, options.now),
    enqueueDueApplicationSyncs({ db }, options.now),
  ]);
  const effects = { claimed: 0, succeeded: 0, failed: 0, superseded: 0 };
  const emptyJobs = (): RunDueJobsResult => ({
    claimed: 0,
    succeeded: 0,
    failed: 0,
    retried: 0,
    superseded: 0,
  });
  const jobs = emptyJobs();
  const graphSync = emptyJobs();
  const proposals = emptyJobs();
  const memories = emptyJobs();
  const agentMemories = emptyJobs();
  const entitySyncs = emptyJobs();
  const applicationSyncs = emptyJobs();
  const addEffects = (batch: typeof effects) => {
    effects.claimed += batch.claimed;
    effects.succeeded += batch.succeeded;
    effects.failed += batch.failed;
    effects.superseded += batch.superseded;
  };
  const addJobs = (total: RunDueJobsResult, batch: RunDueJobsResult) => {
    total.claimed += batch.claimed;
    total.succeeded += batch.succeeded;
    total.failed += batch.failed;
    total.retried += batch.retried;
    total.superseded += batch.superseded;
  };

  // Each claim stays bounded; a tick walks several windows so a recovered
  // worker drains backlog instead of advancing it by one small batch per cron.
  for (let pass = 0; pass < (options.queuePasses ?? 5); pass += 1) {
    const [
      batchEffects,
      batchJobs,
      batchGraph,
      batchProposals,
      batchMemories,
      batchAgentMemories,
      batchEntitySyncs,
      batchApplicationSyncs,
    ] = await Promise.all([
      drainTurnEffects(db, { limit: 50, now: options.now }),
      runDueIngestJobs({ db }, { workerId, limit: 10, now: options.now }),
      runDueGraphSyncJobs(
        { db },
        { workerId: `${workerId}-graph`, limit: 20, now: options.now },
      ),
      runDueProposalJobs(
        { db },
        { workerId: `${workerId}-proposals`, limit: 10, now: options.now },
      ),
      runDueMemoryPromotionJobs(
        { db },
        { workerId: `${workerId}-memories`, limit: 20, now: options.now },
      ),
      runDueAgentMemoryJobs(
        { db },
        { workerId: `${workerId}-agent-memory`, limit: 20, now: options.now },
      ),
      runDueEntitySyncJobs(
        { db },
        { workerId: `${workerId}-entity-sync`, limit: 10, now: options.now },
      ),
      runDueApplicationSyncJobs(
        { db },
        { workerId: `${workerId}-application-sync`, limit: 10, now: options.now },
      ),
    ]);
    addEffects(batchEffects);
    addJobs(jobs, batchJobs);
    addJobs(graphSync, batchGraph);
    addJobs(proposals, batchProposals);
    addJobs(memories, batchMemories);
    addJobs(agentMemories, batchAgentMemories);
    addJobs(entitySyncs, batchEntitySyncs);
    addJobs(applicationSyncs, batchApplicationSyncs);
    if (
      batchEffects.claimed +
        batchJobs.claimed +
        batchGraph.claimed +
        batchProposals.claimed +
        batchMemories.claimed +
        batchAgentMemories.claimed +
        batchEntitySyncs.claimed +
        batchApplicationSyncs.claimed ===
      0
    ) {
      break;
    }
  }

  const claimedAt = observedAt;
  const crawlWorkerId = `${workerId}-${crypto.randomUUID()}`;
  const pending = await db.claimProcessingCrawlSources({
    workerId: crawlWorkerId,
    now: claimedAt.toISOString(),
    staleBefore: new Date(claimedAt.getTime() - CRAWL_FINALIZE_LEASE_MS).toISOString(),
    limit: options.limit ?? CRAWL_FINALIZE_BATCH_SIZE,
  });

  const results = await Promise.all(
    pending.map(async ({ sourceId, collectionId, assistantId }) => {
      try {
        const status = await finalizeWebsiteCrawl({
          db,
          assistantId,
          collectionId,
          sourceId,
          claimedWorkerId: crawlWorkerId,
        });
        return { sourceId, status };
      } catch (error) {
        return {
          sourceId,
          status: "error" as const,
          message: thrownMessage(error, "finalize failed"),
        };
      }
    })
  );

  const settled = results.filter((r) => r.status !== "processing").length;
  const backlog = await db
    .getWorkQueueHealth(observedAt.toISOString())
    .catch(emptyBacklog);
  const ledgerSweep = await db.sweepRuntimeLedgers(
    observedAt.toISOString(),
    500
  );
  return {
    effects,
    jobs,
    graphSync,
    proposals,
    memories,
    agentMemories,
    entitySyncs: { ...entitySyncs, enqueued: entityEnqueued.enqueued },
    applicationSyncs: {
      ...applicationSyncs,
      enqueued: applicationEnqueued.enqueued,
    },
    crawls: { swept: pending.length, settled, results },
    backlog,
    ledgerSweep,
  };
}

/**
 * Bounded goal evals per tick: they cost tokens; leftovers stay due and are
 * picked up by the next tick.
 */
export const GOAL_EVAL_BATCH_SIZE = 10;

export interface AgenticOpsReport {
  goals: Awaited<ReturnType<typeof runDueGoalEvals>>;
  verification: Awaited<ReturnType<typeof runDueAnswerVerifications>>;
  trust: Awaited<ReturnType<typeof runTrustMaterialization>>;
  compost: Awaited<ReturnType<typeof runCompostPass>>;
}

/**
 * The nightly agentic-ops tick: standing goals, the answer verifier, trust
 * materialization, compost, in that order, and the ORDER is the policy:
 * trust materializes after verification so tonight's verdicts feed tonight's
 * tiers, and compost runs last over everything the night produced (internally
 * weekly-gated per assistant). This sequencing and the batch size used to
 * live in the `verify-goals` cron route, exactly what this module exists to
 * keep out of Next handlers; the route is an auth-and-serialize adapter over
 * this one drain.
 */
export async function runDueAgenticOps(
  deps: ScheduledDeps,
  options: { goalLimit?: number } = {}
): Promise<AgenticOpsReport> {
  const { db } = deps;
  const goals = await runDueGoalEvals(
    { db },
    { limit: options.goalLimit ?? GOAL_EVAL_BATCH_SIZE }
  );
  // The verifier rides the same daily tick (deployment-plan cron limit); its
  // per-message unique verdict makes overlapping ticks harmless.
  const verification = await runDueAnswerVerifications({ db });
  const trust = await runTrustMaterialization({ db });
  const compost = await runCompostPass({ db });
  return { goals, verification, trust, compost };
}

/** One organization's outcome in a trace-retention tick (#573). */
export type SweptTraceResult =
  | { organizationId: string; retentionDays: number; cleared: number }
  | { organizationId: string; retentionDays: number; error: string };

export interface SweepExpiredTracesReport {
  traces: { organizations: number; cleared: number; results: SweptTraceResult[] };
}

/** A per-Organization retention policy row, as both list methods return it. */
interface RetentionPolicy {
  organizationId: string;
  retentionDays: number;
}

/** One org's outcome in either sweep, before the count gets its real name. */
type SweptPolicyResult =
  | { organizationId: string; retentionDays: number; count: number }
  | { organizationId: string; retentionDays: number; error: string };

/**
 * Writes one retention audit row (#801, CYB-12), and never lets that write
 * take the sweep down with it: the deletion already happened, and an audit
 * hiccup must not surface as "retention failed" when it did not.
 */
async function recordSweepAudit(
  db: ScheduledDeps["db"],
  event: RetentionSweepEventInput
): Promise<void> {
  try {
    await db.recordRetentionSweep(event);
  } catch {
    // Ledger down ≠ sweep failed. The tick's own result carries the counts.
  }
}

/**
 * The shape both retention sweeps share: list the orgs that opted in, turn
 * each window into a cutoff, run one primitive per org, write the durable
 * audit row (#801, CYB-12) for every outcome, zero ticks and failures
 * included, and report per-org results without letting one failure abort the
 * rest. The two sweeps differ only in which primitive runs and what its count
 * means, so that is all a caller supplies.
 *
 * Idempotent because the primitives are: a cleared trace is null and a deleted
 * conversation is gone, so neither matches a second pass.
 */
async function sweepRetentionPolicies(input: {
  db: ScheduledDeps["db"];
  policies: RetentionPolicy[];
  now: Date;
  policy: RetentionSweepEventInput["policy"];
  errorLabel: string;
  run: (organizationId: string, cutoffIso: string) => Promise<number>;
}): Promise<{ total: number; results: SweptPolicyResult[] }> {
  const results = await Promise.all(
    input.policies.map(
      async ({ organizationId, retentionDays }): Promise<SweptPolicyResult> => {
        const cutoff = new Date(
          input.now.getTime() - retentionDays * 24 * 60 * 60 * 1000
        ).toISOString();
        try {
          const count = await input.run(organizationId, cutoff);
          // The audit row is the tick's durable evidence: the cron response is
          // read once and stored nowhere. Recorded even for a zero tick, "the
          // policy ran and nothing was due" is an answer an operator needs as
          // much as a count.
          await recordSweepAudit(input.db, {
            organizationId,
            policy: input.policy,
            retentionDays,
            cutoff,
            deleted: count,
          });
          return { organizationId, retentionDays, count };
        } catch (error) {
          const message = thrownMessage(error, input.errorLabel);
          await recordSweepAudit(input.db, {
            organizationId,
            policy: input.policy,
            retentionDays,
            cutoff,
            error: message,
          });
          return { organizationId, retentionDays, error: message };
        }
      }
    )
  );
  const total = results.reduce(
    (sum, r) => sum + ("count" in r ? r.count : 0),
    0
  );
  return { total, results };
}

/**
 * Per-Organization trace-retention sweep (#573). For every org that opted into
 * a retention window, strips the persisted Turn Trace from messages older than
 * the window, the message itself (content, feedback, timestamps) stays, so
 * the Inbox keeps the bubble and simply renders no Thinking panel.
 */
export async function sweepExpiredTraces(
  deps: ScheduledDeps,
  options: { now?: Date } = {}
): Promise<SweepExpiredTracesReport> {
  const { db } = deps;
  const policies = await db.listTraceRetentionPolicies();
  const swept = await sweepRetentionPolicies({
    db,
    policies,
    now: options.now ?? new Date(),
    policy: "traces",
    errorLabel: "trace sweep failed",
    run: (organizationId, cutoff) => db.clearExpiredTraces(organizationId, cutoff),
  });
  return {
    traces: {
      organizations: policies.length,
      cleared: swept.total,
      results: swept.results.map((r): SweptTraceResult =>
        "count" in r
          ? {
              organizationId: r.organizationId,
              retentionDays: r.retentionDays,
              cleared: r.count,
            }
          : r
      ),
    },
  };
}

/**
 * How long object-access ledger rows are kept (#801, CYB-19). Operational
 * retention, not a tenant policy: the rows carry IP and user agent, so
 * keeping them forever is its own finding, and 400 days clears an annual
 * audit cycle with margin. The detection rules read 30 days, so no detection
 * is ever starved by this.
 */
export const OBJECT_ACCESS_RETENTION_DAYS = 400;

export interface SweepObjectAccessReport {
  objectAccess: { purged: number };
}

/**
 * Purges ledger rows past the retention window (#801, CYB-19), every
 * organization at once. Idempotent: a purged row never matches again.
 */
export async function sweepExpiredObjectAccess(
  deps: ScheduledDeps,
  options: { now?: Date } = {}
): Promise<SweepObjectAccessReport> {
  const now = options.now ?? new Date();
  const cutoff = new Date(
    now.getTime() - OBJECT_ACCESS_RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const purged = await deps.db.purgeExpiredObjectAccessEvents(cutoff);
  return { objectAccess: { purged } };
}

/** One organization's outcome in a transcript-retention tick (#801, CYB-12). */
export type SweptTranscriptResult =
  | { organizationId: string; retentionDays: number; deleted: number }
  | { organizationId: string; retentionDays: number; error: string };

export interface SweepExpiredTranscriptsReport {
  transcripts: {
    organizations: number;
    deleted: number;
    results: SweptTranscriptResult[];
  };
}

/**
 * Per-Organization transcript-retention sweep (#801, CYB-12). For every org
 * that opted into a window, deletes Conversations older than it, messages and
 * links included. Conversations under legal hold are skipped by the sweep
 * primitive itself, so a preservation obligation survives a policy change
 * nobody remembered it during.
 *
 * The counterpart to {@link sweepExpiredTraces}, and deliberately a different
 * policy: that one strips the Thinking trace and keeps the transcript, this
 * one is the lifecycle the privacy page promises. An organization can set
 * either, both, or neither.
 */
export async function sweepExpiredTranscripts(
  deps: ScheduledDeps,
  options: { now?: Date } = {}
): Promise<SweepExpiredTranscriptsReport> {
  const { db } = deps;
  const policies = await db.listTranscriptRetentionPolicies();
  const swept = await sweepRetentionPolicies({
    db,
    policies,
    now: options.now ?? new Date(),
    policy: "transcripts",
    errorLabel: "transcript sweep failed",
    run: (organizationId, cutoff) =>
      db.deleteExpiredConversations(organizationId, cutoff),
  });
  return {
    transcripts: {
      organizations: policies.length,
      deleted: swept.total,
      results: swept.results.map((r): SweptTranscriptResult =>
        "count" in r
          ? {
              organizationId: r.organizationId,
              retentionDays: r.retentionDays,
              deleted: r.count,
            }
          : r
      ),
    },
  };
}
