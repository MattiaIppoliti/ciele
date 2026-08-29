import { withCronAuth } from "@/lib/cron-auth";
import { getWidgetDb } from "@/lib/widget-db";
import { routineTeammateActions } from "@/lib/teammates/actions";
import { runDueRoutines } from "@agent-hub/agent";

/**
 * Unattended Teammate Routines (#772), the HTTP adapter.
 *
 * Its own tick, and that is the point of it existing separately. A Routine
 * carries a preferred hour, and while this drain rode the nightly crawl
 * finalizer every routine ran at 03:00 whatever its author picked: the slot rule
 * correctly reported that yesterday's 08:00 slot had passed, so the 03:00 tick
 * claimed it. Only a tick that runs more often than once a day can honour the
 * hour, and because the claim is a compare-and-set on `last_run_at`, the extra
 * ticks that find nothing due are cheap and cannot double-run anything.
 *
 * **How often it ticks is the deployment's decision, and the two differ.** A
 * self-host runs it hourly (`deploy/cron/crontab`), so the hour is honoured.
 * `vercel.json` asks for daily because Vercel's Hobby plan rejects anything more
 * frequent, and rejects it by failing the deployment rather than degrading; on
 * that plan every routine runs at the daily tick and its hour is approximate.
 * Making the hosted deployment honour the hour is a one-line change to the
 * schedule once the plan is Pro. Nothing here needs to change either way.
 *
 * Cron auth in, the tick's report out. What a tick does is `runDueRoutines` in
 * `@agent-hub/agent`, where it is tested without a request.
 *
 * `routineTeammateActions` is the port that turns grant rows into tools: the
 * runtime does not know operations exist, so what an unattended run may do
 * arrives from here. Unwired, a routine can talk and search and nothing else.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withCronAuth(async () =>
  Response.json(
    await runDueRoutines({
      db: getWidgetDb(),
      teammateActions: routineTeammateActions,
    })
  )
);
