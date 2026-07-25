import { withCronAuth } from "@/lib/cron-auth";
import { getWidgetDb } from "@/lib/widget-db";
import {
  CRAWL_FINALIZE_LEASE_MS,
  finalizeWebsiteCrawl,
  runDueGraphSyncJobs,
  runDueIngestJobs,
  runDueProposalJobs,
} from "@/lib/runtime";

/**
 * Background safety-net for website crawls. The Knowledge UI polls in-flight
 * crawls while it's open, but an admin who closes the tab mid-crawl would
 * otherwise leave the Source stuck on `processing`. Each tick atomically
 * claims one bounded, least-recently-attempted batch (across all orgs, via the
 * service role) and finalizes any whose Apify run has finished — the durable
 * counterpart to the client poll.
 *
 * Scheduled daily in vercel.json (the Hobby-plan cron limit — the client-side
 * poll handles the common tab-open case, this is the closed-tab backstop; bump
 * to a tighter schedule on Pro). Protected by CRON_SECRET (Vercel sends it as a
 * Bearer token); without the secret configured we refuse to run.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;
/**
 * Finalization can fetch and ingest a complete website. Keep each cron run
 * deliberately small so one slow batch never fans out across every pending
 * crawl; remaining Sources stay `processing` for the next tick.
 */
export const CRAWL_FINALIZE_BATCH_SIZE = 5;

export const GET = withCronAuth(async () => {
  const db = getWidgetDb();
  const jobs = await runDueIngestJobs(
    { db },
    { workerId: "cron-finalize-crawls", limit: 10 }
  );
  // Durable backstop for the graph-sync ledger (the `after()` accelerator's
  // safety net). Inert when the graph worker is unconfigured — no rows queue.
  const graphSync = await runDueGraphSyncJobs(
    { db },
    { workerId: "cron-finalize-crawls-graph", limit: 20 }
  );
  // Backstop for Suggested Fix drafting jobs (#390); best-effort like the rest.
  const proposals = await runDueProposalJobs(
    { db },
    { workerId: "cron-finalize-crawls-proposals", limit: 10 }
  );
  const claimedAt = new Date();
  const crawlWorkerId = `cron-finalize-crawls-${crypto.randomUUID()}`;
  const pending = await db.claimProcessingCrawlSources({
    workerId: crawlWorkerId,
    now: claimedAt.toISOString(),
    staleBefore: new Date(claimedAt.getTime() - CRAWL_FINALIZE_LEASE_MS).toISOString(),
    limit: CRAWL_FINALIZE_BATCH_SIZE,
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
          message: error instanceof Error ? error.message : "finalize failed",
        };
      }
    })
  );

  const settled = results.filter((r) => r.status !== "processing").length;
  return Response.json({
    jobs,
    graphSync,
    proposals,
    crawls: { swept: pending.length, settled, results },
  });
});
