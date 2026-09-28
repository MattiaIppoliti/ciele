import type { SupabaseClient } from "@supabase/supabase-js";
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
