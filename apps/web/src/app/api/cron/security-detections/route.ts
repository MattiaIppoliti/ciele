import { withCronAuth } from "@/lib/cron-auth";
import { getWidgetDb } from "@/lib/widget-db";
import { runSecurityDetections } from "@agent-hub/agent";

/**
 * Detection-as-code tick (#801, CYB-19), the HTTP adapter.
 *
 * Cron auth in, the tick's report out. What a tick actually does, running the
 * portable rules over each Organization's object-access ledger window and
 * raising keyed Alerts for what fires, is `runSecurityDetections` in
 * `@agent-hub/agent`, where the rules and thresholds are tested without a
 * request.
 *
 * Scheduled daily in vercel.json; the tick is idempotent for a quiet window
 * (no findings, no writes) and dedupes a noisy one by sourceKey, so a finer
 * schedule only changes how promptly a finding surfaces. Protected by
 * CRON_SECRET; without the secret configured we refuse to run.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withCronAuth(async () => {
  const report = await runSecurityDetections({ db: getWidgetDb() });
  return Response.json(report);
});
