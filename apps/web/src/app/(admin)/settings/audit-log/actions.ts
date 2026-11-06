"use server";
import { after } from "next/server";
import { exportAuditLogOp } from "@ciele/ops";
import { runOperation } from "@/lib/operations";
import { drainDueExportJobs } from "@/lib/exports/drain";
export async function exportAuditLogAction(input: {
  memberId?: string;
  domain?: string;
  operations?: string[];
  from?: string;
  to?: string;
  order?: "newest" | "oldest";
}) {
  const job = await runOperation(exportAuditLogOp, input);
  after(() => drainDueExportJobs().catch(() => {}));
  return job.id;
}
