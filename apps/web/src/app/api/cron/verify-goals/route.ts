import { withCronAuth } from "@/lib/cron-auth";
import { getWidgetDb } from "@/lib/widget-db";
import { runDueAgenticOps } from "@agent-hub/agent";

/**
 * Nightly agentic-ops tick (spec: scheduled golden-question checks feeding
 * Alerts). Auth-and-serialize only, the batch size and the
 * goals → verification → trust → compost sequencing are policy and live in
 * the runtime's `runDueAgenticOps` drain (packages/agent/src/scheduled.ts),
 * where they are testable without a request. Protected by CRON_SECRET like
 * the crawl finalizer.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withCronAuth(async () => {
  const db = getWidgetDb();
  return Response.json(await runDueAgenticOps({ db }));
});
