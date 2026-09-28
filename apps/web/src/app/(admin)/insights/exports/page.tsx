import { ExportsClient, type ExportRow } from "@/components/insights/exports-client";
import { requirePageMember } from "@/lib/authz";
import { defaultInsightsFilter } from "@/lib/insights/report";

export const dynamic = "force-dynamic";

export default async function ExportsPage() {
  const { organizationId, db, reads } = await requirePageMember();

  const [jobs, assistants] = await Promise.all([db.listExportJobs(organizationId), reads.assistants()]);

  const rows: ExportRow[] = jobs.map((job) => ({
    id: job.id,
    name: typeof job.params.name === "string" && job.params.name ? job.params.name : null,
    kind: job.kind,
    status: job.status,
    format: job.format,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    // A link to our own route, not a signed URL minted for every finished job
    // on every page load whether or not anyone clicked (#801, CYB-05). The
    // route authorizes at click time and records the bytes it serves.
    downloadUrl:
      job.status === "done" && job.storagePath
        ? `/api/insights/exports/${encodeURIComponent(job.id)}`
        : null,
  }));

  return (
    <ExportsClient
      rows={rows}
      assistants={assistants.map((a) => ({ id: a.id, title: a.title }))}
      defaultFilter={defaultInsightsFilter()}
    />
  );
}
