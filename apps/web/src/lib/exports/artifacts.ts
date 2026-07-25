import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExportJob } from "@agent-hub/db";
import {
  getInsightsOverview,
  insightsFilterFromSearchParams,
  type InsightsFilter,
} from "@/lib/insights/report";
import { uploadExportArtifact } from "@/lib/storage/exports";
import { insightsOverviewToCsv } from "./insights-csv";
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

/** The concrete render step wired into the cron worker. */
export async function renderExportArtifact(
  client: SupabaseClient,
  job: ExportJob
): Promise<ExportArtifact> {
  switch (job.kind) {
    case "insights_overview": {
      const overview = await getInsightsOverview(
        job.organizationId,
        filterFromParams(job.params),
        client
      );
      return { body: insightsOverviewToCsv(overview), format: "csv" };
    }
    default:
      throw new Error(`Unsupported export kind: ${job.kind}`);
  }
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
