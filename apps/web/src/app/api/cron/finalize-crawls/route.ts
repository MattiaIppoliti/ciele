import { withCronAuth } from "@/lib/cron-auth";
import { getWidgetDb } from "@/lib/widget-db";
import { finalizeDueCrawls } from "@agent-hub/agent";

/**
 * Background safety-net for website crawls and the durable job ledger, the
 * HTTP adapter.
 *
 * Cron auth in, the tick's report out. What a tick actually does, draining the
 * ledger, then claiming and finalizing a bounded batch of in-flight crawls, is
 * `finalizeDueCrawls` in `@agent-hub/agent`, where it is tested without a
 * request.
 *
 * Scheduled daily in vercel.json (the Hobby-plan cron limit, the client-side
 * poll handles the common tab-open case, this is the closed-tab backstop; bump
 * to a tighter schedule on Pro). Protected by CRON_SECRET (Vercel sends it as a
 * Bearer token); without the secret configured we refuse to run.
 *
 * Teammate Routines (#772) used to ride this tick and no longer do: they carry a
 * preferred hour, and a daily tick ran every one of them at 03:00. They have
 * their own hourly cron, `/api/cron/run-routines`.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withCronAuth(async () =>
  Response.json(
    await finalizeDueCrawls({ db: getWidgetDb() })
  )
);
