import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExportJobFormat } from "@agent-hub/core";

/**
 * Private bucket for generated report artifacts (ADR-0010): reads go through
 * short-lived signed URLs and an org-membership policy, never a public URL.
 * Reuses the per-org path layout established by the public-assets bucket
 * (#33): org/{organizationId}/exports/{jobId}.{ext}.
 */
export const ANALYTICS_EXPORTS_BUCKET = "analytics-exports";

const FORMAT_EXTENSIONS: Record<ExportJobFormat, string> = {
  csv: "csv",
};

const FORMAT_CONTENT_TYPES: Record<ExportJobFormat, string> = {
  csv: "text/csv",
};

export function exportObjectPath(input: {
  organizationId: string;
  jobId: string;
  format: ExportJobFormat;
}): string {
  const ext = FORMAT_EXTENSIONS[input.format];
  return `org/${input.organizationId}/exports/${input.jobId}.${ext}`;
}

/** Writes an export artifact for the given job and returns its storage path. */
export async function uploadExportArtifact(
  client: SupabaseClient,
  input: {
    organizationId: string;
    jobId: string;
    format: ExportJobFormat;
    body: string;
  }
): Promise<{ path: string }> {
  const path = exportObjectPath(input);
  const { error } = await client.storage
    .from(ANALYTICS_EXPORTS_BUCKET)
    .upload(path, input.body, {
      contentType: FORMAT_CONTENT_TYPES[input.format],
      // Re-runs (retry, stale reclaim) overwrite the same object — the job id
      // is stable, so a repeated run is idempotent at the storage seam too.
      upsert: true,
    });
  if (error) throw error;
  return { path };
}

/** Short-lived signed download URL for a stored export artifact. */
export async function createExportDownloadUrl(
  client: SupabaseClient,
  path: string,
  expiresInSeconds = 600
): Promise<string | null> {
  const { data, error } = await client.storage
    .from(ANALYTICS_EXPORTS_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}
