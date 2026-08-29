import { withCronAuth } from "@/lib/cron-auth";
import { getWidgetDb } from "@/lib/widget-db";

/**
 * Maintains the usage_daily rollup (#438, decision #420): recomputes the last
 * ROLLUP_WINDOW_DAYS UTC days from the raw ai_usage ledger so cap checks and
 * the org usage page read a cheap aggregate instead of scanning events. The
 * two-day window re-covers yesterday on every run, so events that land after
 * midnight (in-flight turns, delayed scheduled work) are never lost; the
 * recompute is idempotent, so overlapping or repeated ticks are safe.
 *
 * Scheduled daily in vercel.json (deployment-plan cron limit). Protected by
 * CRON_SECRET (sent as a Bearer token); without the secret configured we
 * refuse to run. Service-role Db: the rollup spans every organization.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const ROLLUP_WINDOW_DAYS = 2;

export const GET = withCronAuth(async () => {
  const upserted = await getWidgetDb().rollupUsageDaily(ROLLUP_WINDOW_DAYS);
  return Response.json({ upserted, windowDays: ROLLUP_WINDOW_DAYS });
});
