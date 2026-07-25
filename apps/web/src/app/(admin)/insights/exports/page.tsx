import { isSupabaseConfigured } from "@agent-hub/db";
import { ExportsClient, type ExportRow } from "@/components/insights/exports-client";
import { requirePageMember } from "@/lib/authz";
import { createExportDownloadUrl } from "@/lib/storage/exports";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ExportsPage() {
  const { organizationId, db } = await requirePageMember();

  const jobs = await db.listExportJobs(organizationId);

  // Finished artifacts are served through short-lived signed URLs — the
  // bucket is private, so a link is minted per page load and never persisted.
  const downloadUrls: Record<string, string> = {};
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const resolved = await Promise.all(
      jobs
        .filter((job) => job.status === "done" && job.storagePath)
        .map(
          async (job) =>
            [job.id, await createExportDownloadUrl(supabase, job.storagePath!)] as const
        )
    );
    for (const [id, url] of resolved) if (url) downloadUrls[id] = url;
  }

  const rows: ExportRow[] = jobs.map((job) => ({
    id: job.id,
    kind: job.kind,
    status: job.status,
    format: job.format,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    downloadUrl: downloadUrls[job.id] ?? null,
  }));

  return <ExportsClient rows={rows} />;
}
