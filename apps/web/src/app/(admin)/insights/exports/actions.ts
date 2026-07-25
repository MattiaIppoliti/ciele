"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireMember } from "@/lib/authz";
import { drainDueExportJobs } from "@/lib/exports/drain";
import { defaultInsightsFilter, type InsightsFilter } from "@/lib/insights/report";

const EXPORTS_PATH = "/insights/exports";

/**
 * Queues an Insights Overview export. Generation runs off the request path:
 * the durable job row is the source of truth, and `after()` only accelerates
 * the common case — the daily cron backstop still runs it if this in-process
 * drain never completes.
 */
export async function requestInsightsExportAction(
  filters?: Partial<InsightsFilter>
): Promise<void> {
  const { db, organizationId } = await requireMember();
  const snapshot: InsightsFilter = { ...defaultInsightsFilter(), ...filters };
  await db.createExportJob(organizationId, {
    kind: "insights_overview",
    format: "csv",
    params: { ...snapshot },
  });
  after(() => drainDueExportJobs().catch(() => {}));
  revalidatePath(EXPORTS_PATH);
}

/** Re-queues a failed export for another run. */
export async function retryExportJobAction(id: string): Promise<void> {
  const { db, organizationId } = await requireMember();
  const job = await db.getExportJob(id);
  if (!job || job.organizationId !== organizationId) {
    throw new Error("Export not found");
  }
  await db.requeueExportJob(id);
  after(() => drainDueExportJobs().catch(() => {}));
  revalidatePath(EXPORTS_PATH);
}
