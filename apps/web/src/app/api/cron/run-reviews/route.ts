import { withCronAuth } from "@/lib/cron-auth";
import { getWidgetDb } from "@/lib/widget-db";
import { runDueReviewJobs } from "@agent-hub/agent";

/**
 * The Human review gate's clock and drain (#841): expire overdue requests,
 * then run the delivery and continuation jobs. Deliveries and continuations
 * are also drained right after the request that queued them (the
 * after-response hook), so this tick is the net under a cold serverless
 * instance and the only place expiry happens.
 *
 * Hourly on a self-host; daily on Vercel's Hobby plan, which refuses anything
 * more frequent (see `run-routines`). A 24h timeout is therefore approximate
 * on the hosted plan until it is Pro.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withCronAuth(async () =>
  Response.json(await runDueReviewJobs({ db: getWidgetDb() }))
);
