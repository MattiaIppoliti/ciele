"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireMember } from "@/lib/authz";
import { drainDueExportJobs } from "@/lib/exports/drain";
import { z } from "zod";
import { insightsFilterFromSearchParams } from "@/lib/insights/report";

const EXPORTS_PATH = "/insights/exports";

const ExportRequest = z.object({
  name: z.string().trim().min(1, "Give the export a name").max(120),
  kind: z.enum(["insights_overview", "insights_datapoints", "insights_languages"]),
  format: z.enum(["csv", "json", "xlsx"]),
  // Parsed by the same function the Insights page uses, so a hand-written
  // value falls back to its default instead of reaching the worker.
  filters: z.record(z.string(), z.string()).default({}),
});

export type ExportRequestInput = z.input<typeof ExportRequest>;

/**
 * Queues an Insights export with the name, report kind, file type and filter
 * snapshot the Create export dialog chose. Generation runs off the request
 * path: the durable job row is the source of truth, and `after()` only
 * accelerates the common case, the daily cron backstop still runs it if this
 * in-process drain never completes.
 */
export async function requestInsightsExportAction(
  input: ExportRequestInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = ExportRequest.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid export" };
  }
  const { db, organizationId } = await requireMember();
  const { name, kind, format, filters } = parsed.data;
  const snapshot = insightsFilterFromSearchParams(new URLSearchParams(filters));
  await db.createExportJob(organizationId, {
    kind,
    format,
    params: { ...snapshot, name },
  });
  after(() => drainDueExportJobs().catch(() => {}));
  revalidatePath(EXPORTS_PATH);
  return { ok: true };
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
