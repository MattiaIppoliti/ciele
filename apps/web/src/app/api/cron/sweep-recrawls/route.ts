import { withCronAuth } from "@/lib/cron-auth";
import { getWidgetDb } from "@/lib/widget-db";
import { sweepDueRecrawls } from "@agent-hub/agent";

/**
 * Scheduled re-crawl sweep (#36) — the HTTP adapter.
 *
 * Cron auth in, the tick's report out. What a tick actually does — claiming a
 * bounded batch of due Sources and starting each through the same pipeline as a
 * manual re-crawl — is `sweepDueRecrawls` in `@agent-hub/agent`, where it is
 * tested without a request.
 *
 * Scheduled daily in vercel.json (the deployment-plan cron limit); a
 * finer-grained schedule only changes how promptly a due Source is picked up.
 * Protected by CRON_SECRET (Vercel sends it as a Bearer token); without the
 * secret configured we refuse to run.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withCronAuth(async () =>
  Response.json(await sweepDueRecrawls({ db: getWidgetDb() }))
);
