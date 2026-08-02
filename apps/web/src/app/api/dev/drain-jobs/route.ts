import { getWidgetDb } from "@/lib/widget-db";
import { runDueIngestJobs } from "@agent-hub/agent";

/**
 * Dev-only job drain: the durable job ledger has no cron in `next dev`, so
 * this route lets a local session claim and run due jobs on demand and see
 * the outcome. 404s outside development.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const db = getWidgetDb();
  const result = await runDueIngestJobs({ db }, { limit: 5 });
  return Response.json({ result });
}
