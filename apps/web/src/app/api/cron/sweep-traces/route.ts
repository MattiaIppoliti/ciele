import { withCronAuth } from "@/lib/cron-auth";
import { getWidgetDb } from "@/lib/widget-db";
import { sweepExpiredTraces } from "@agent-hub/agent";

/**
 * Trace-retention sweep (#573) — the HTTP adapter.
 *
 * Cron auth in, the tick's report out. What a tick actually does — clearing
 * expired Turn Traces for every Organization that opted into a retention
 * window, leaving the messages themselves intact — is `sweepExpiredTraces` in
 * `@agent-hub/agent`, where it is tested without a request.
 *
 * Scheduled daily in vercel.json; the sweep is idempotent, so a finer schedule
 * only changes how promptly an expired trace disappears. Protected by
 * CRON_SECRET (Vercel sends it as a Bearer token); without the secret
 * configured we refuse to run.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withCronAuth(async () =>
  Response.json(await sweepExpiredTraces({ db: getWidgetDb() }))
);
