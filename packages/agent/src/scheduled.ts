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

import type { SourceStatus } from "@agent-hub/core";
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
import { runDueAnswerVerifications } from "./verifier";
import {
  enqueueDueEntitySyncs,
  type RunDueJobsResult,
  runDueEntitySyncJobs,
  runDueGraphSyncJobs,
  runDueIngestJobs,
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
  jobs: RunDueJobsResult;
  graphSync: RunDueJobsResult;
  proposals: RunDueJobsResult;
  memories: RunDueJobsResult;
  entitySyncs: RunDueJobsResult & { enqueued: number };
  crawls: { swept: number; settled: number; results: FinalizedCrawlResult[] };
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
  options: { now?: Date; limit?: number } = {}
): Promise<FinalizeDueCrawlsReport> {
  const { db } = deps;
  const workerId = FINALIZE_WORKER_ID;
  const jobs = await runDueIngestJobs({ db }, { workerId, limit: 10 });
  // Durable backstop for the graph-sync ledger. Inert when the graph worker is
  // unconfigured, no rows queue.
  const graphSync = await runDueGraphSyncJobs(
    { db },
    { workerId: `${workerId}-graph`, limit: 20 }
  );
  // Backstop for Suggested Fix drafting jobs (#390); best-effort like the rest.
  const proposals = await runDueProposalJobs(
    { db },
    { workerId: `${workerId}-proposals`, limit: 10 }
  );
  const memories = await runDueMemoryPromotionJobs(
    { db },
    { workerId: `${workerId}-memories`, limit: 20 }
  );
  const syncsEnqueued = await enqueueDueEntitySyncs({ db });
  const entitySyncs = await runDueEntitySyncJobs(
    { db },
    { workerId: `${workerId}-entity-sync`, limit: 10 }
  );

  const claimedAt = options.now ?? new Date();
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
  return {
    jobs,
    graphSync,
    proposals,
    memories,
    entitySyncs: { ...entitySyncs, enqueued: syncsEnqueued.enqueued },
    crawls: { swept: pending.length, settled, results },
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

/**
 * Per-Organization trace-retention sweep (#573). For every org that opted into
 * a retention window, strips the persisted Turn Trace from messages older than
 * the window, the message itself (content, feedback, timestamps) stays, so
 * the Inbox keeps the bubble and simply renders no Thinking panel.
 *
 * Idempotent by construction: a cleared trace is null and never matches again,
 * so running the sweep twice in a window clears nothing the second time. One
 * org failing never aborts the rest; the tick reports per-org outcomes the way
 * the other drains do.
 */
export async function sweepExpiredTraces(
  deps: ScheduledDeps,
  options: { now?: Date } = {}
): Promise<SweepExpiredTracesReport> {
  const { db } = deps;
  const now = options.now ?? new Date();
  const policies = await db.listTraceRetentionPolicies();

  const results = await Promise.all(
    policies.map(
      async ({ organizationId, retentionDays }): Promise<SweptTraceResult> => {
        const cutoff = new Date(
          now.getTime() - retentionDays * 24 * 60 * 60 * 1000
        ).toISOString();
        try {
          const cleared = await db.clearExpiredTraces(organizationId, cutoff);
          return { organizationId, retentionDays, cleared };
        } catch (error) {
          return {
            organizationId,
            retentionDays,
            error: thrownMessage(error, "trace sweep failed"),
          };
        }
      }
    )
  );

  const cleared = results.reduce(
    (sum, r) => sum + ("cleared" in r ? r.cleared : 0),
    0
  );
  return { traces: { organizations: policies.length, cleared, results } };
}
