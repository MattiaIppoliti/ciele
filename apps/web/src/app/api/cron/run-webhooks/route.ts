import { withCronAuth } from "@/lib/cron-auth";
import { getWidgetDb } from "@/lib/widget-db";
import { runDueWebhookJobs } from "@agent-hub/agent";

/**
 * The callback gate's clock and drain (#842): expire subscriptions nobody
 * answered, then run the continuations. A continuation is also drained right
 * after the callback that queued it (the after-response hook), so this tick is
 * the net under a cold serverless instance and the only place expiry happens.
 *
 * Its own tick rather than a line inside `run-reviews`, because the two gates
 * wait on different timescales: a colleague has a day to approve, a webhook has
 * fifteen minutes, and a Visitor held for fifteen minutes past that by a shared
 * daily schedule would be waiting on nothing.
 *
 * Hourly on a self-host; daily on Vercel's Hobby plan, which refuses anything
 * more frequent. A short timeout is therefore approximate on the hosted plan
 * until it is Pro, and the expiry message says "in time" rather than a
 * duration for exactly that reason.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withCronAuth(async () =>
  Response.json(await runDueWebhookJobs({ db: getWidgetDb() }))
);
