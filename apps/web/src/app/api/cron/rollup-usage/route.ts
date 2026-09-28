import { withCronAuth } from "@/lib/cron-auth";
import { getWidgetDb } from "@/lib/widget-db";

/**
 * Maintains the usage_daily rollup (#438, decision #420) from the raw ai_usage
 * ledger so cap checks and the org usage page read a cheap aggregate instead of
 * scanning events. Each run recomputes every day after the last one a run
 * closed, never less than today and yesterday (late rows for yesterday are
 * never lost) and never more than ROLLUP_MAX_CATCH_UP_DAYS. Reads take a
 * closed day from the rollup without looking back, so a missed night has to be
 * repaired by the next one, not left short. Idempotent, so overlapping or
 * repeated ticks are safe.
 *
 * Scheduled daily in vercel.json (deployment-plan cron limit). Protected by
 * CRON_SECRET (sent as a Bearer token); without the secret configured we
 * refuse to run. Service-role Db: the rollup spans every organization.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const ROLLUP_MAX_CATCH_UP_DAYS = 35;

export const GET = withCronAuth(async () => {
  const upserted = await getWidgetDb().rollupUsageCatchUp(ROLLUP_MAX_CATCH_UP_DAYS);
  return Response.json({ upserted, maxCatchUpDays: ROLLUP_MAX_CATCH_UP_DAYS });
});
