import { withCronAuth } from "@/lib/cron-auth";
import { getWidgetDb } from "@/lib/widget-db";
import { restartWebsiteCrawl } from "@/lib/runtime";

/**
 * Scheduled re-crawl sweep (issue #36). Turns each Website Source's per-site
 * re-crawl cadence (daily / weekly / monthly; "never" opts out) into hands-off
 * refreshes. Each tick atomically claims a bounded, oldest-crawled-first batch
 * of due Sources across all orgs (via the service role, mirroring
 * finalize-crawls) and runs each through the *same* provider resolution +
 * crawl-start pipeline as a manual re-crawl (`restartWebsiteCrawl`), so a
 * scheduled refresh never invents a provider-specific path — scheduling only
 * decides *when*. Claiming flips a due Source to `processing`, so a Source
 * already crawling is skipped and running the sweep twice in a window never
 * double-crawls (no duplicate remote run is started). The previous ready
 * Concepts stay live until the replacement crawl finalizes with usable pages,
 * so a failed refresh keeps the existing knowledge. Crawl failures surface
 * through the crawl-failure Alert the pipeline already raises when a run
 * finalizes.
 *
 * Scheduled daily in vercel.json (the deployment-plan cron limit); a
 * finer-grained schedule only changes how promptly a due Source is picked up.
 * Protected by CRON_SECRET (Vercel sends it as a Bearer token); without the
 * secret configured we refuse to run.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Each claimed Source triggers a full site crawl. Keep each run deliberately
 * small so one tick never fans out across every due Source at once; the rest
 * stay due and are picked up by the next tick.
 */
export const RECRAWL_SWEEP_BATCH_SIZE = 5;

export const GET = withCronAuth(async () => {
  const db = getWidgetDb();
  const due = await db.claimDueRecrawlSources({
    now: new Date().toISOString(),
    limit: RECRAWL_SWEEP_BATCH_SIZE,
  });

  const results = await Promise.all(
    due.map(async ({ sourceId }) => {
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
          message: error instanceof Error ? error.message : "re-crawl failed",
        };
      }
    })
  );

  const launched = results.filter((r) => r.status === "processing").length;
  return Response.json({ recrawls: { swept: due.length, launched, results } });
});
