import type { SupabaseClient } from "@supabase/supabase-js";
import { createDb } from "@agent-hub/db";
import type { AuditLogEntry, AuditLogFilter } from "@agent-hub/core";
import type { ExportJob } from "@agent-hub/core";
import {
  getInsightsOverview,
  insightsFilterFromSearchParams,
  type InsightsFilter,
} from "@/lib/insights/report";
import { uploadExportArtifact } from "@/lib/storage/exports";
import { EXPORT_KIND_LABELS, insightsExportTable, renderExportTable } from "./insights-export";
import type { ExportArtifact } from "./run-export-jobs";

/** Rebuilds the dashboard filter from the job's stored snapshot. */
function filterFromParams(params: Record<string, unknown>): InsightsFilter {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  return insightsFilterFromSearchParams(search);
}

/**
 * The concrete render step wired into the cron worker. Every kind reads the
 * same overview for the job's filter snapshot and keeps a different slice of
 * it, so an export always agrees with the Insights page for the same filters.
 */
export async function renderExportArtifact(
  client: SupabaseClient,
  job: ExportJob
): Promise<ExportArtifact> {
  if (job.kind === "audit_log") {
    const db = createDb(client);
    const rows: AuditLogEntry[] = [];
    const filter: AuditLogFilter = {};
    for (const key of ["memberId", "domain", "from", "to"] as const) if (typeof job.params[key] === "string") filter[key] = job.params[key];
    // The action filter: the export takes the same operations the page shows.
    if (Array.isArray(job.params.operations)) filter.operations = job.params.operations.filter((item): item is string => typeof item === "string");
    let before: string | undefined;
    let beforeId: string | undefined;
    while (true) {
      const page = await db.listAuditEntries(job.organizationId, { ...filter, before, beforeId, limit: 1000 });
      rows.push(...page);
      if (page.length < 1000) break;
      before = page[page.length - 1].createdAt; beforeId = page[page.length - 1].id;
    }
    const table = { headers: ["time","operation","effect","member_id","member_name","member_email","api_key_id","teammate_id","agent_author","surface","outcome","entities","target","target_detail","changes"], rows: rows.map(row => [row.createdAt,row.operation,row.effect,row.memberId ?? "",row.memberName ?? "",row.memberEmail ?? "",row.apiKeyId ?? "",row.teammateId ?? "",row.agentAuthor ?? "",row.surface,row.outcome,JSON.stringify(row.entities),row.targetLabel ?? "",row.targetDetail ?? "",JSON.stringify(row.changes ?? {})]) };
    return { body: await renderExportTable("csv", table, "Audit log"), format: "csv" };
  }
  const overview = await getInsightsOverview(job.organizationId, filterFromParams(job.params), client);
  const table = insightsExportTable(job.kind, overview);
  const name = typeof job.params.name === "string" && job.params.name ? job.params.name : EXPORT_KIND_LABELS[job.kind];
  return { body: await renderExportTable(job.format, table, name), format: job.format };
}

/** The concrete store step wired into the cron worker. */
export function storeExportArtifact(
  client: SupabaseClient,
  job: ExportJob,
  artifact: ExportArtifact
): Promise<{ path: string }> {
  return uploadExportArtifact(client, {
    organizationId: job.organizationId,
    jobId: job.id,
    format: artifact.format,
    body: artifact.body,
  });
}
