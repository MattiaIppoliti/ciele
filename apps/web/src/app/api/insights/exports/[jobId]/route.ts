import { NextRequest } from "next/server";
import { ANALYTICS_EXPORTS_BUCKET } from "@/lib/storage/exports";
import { serveAdminDownload } from "@/lib/storage/admin-download";

/**
 * Download of a finished analytics export (#801, CYB-05).
 *
 * The Exports page used to mint a ten-minute signed URL for every finished job
 * on every page load, whether or not anyone clicked. That made "a link exists"
 * and "an export left the building" indistinguishable, and put a working URL
 * for the org's whole conversation history into a rendered page. Now the page
 * links here, and the row is written when bytes move.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  return serveAdminDownload(request, {
    objectKind: "analytics_export",
    fallbackPath: `export:${jobId}`,
    resolve: async (db, organizationId) => {
      // The listing is org-scoped, so a foreign job id is simply absent here.
      const jobs = await db.listExportJobs(organizationId);
      const job = jobs.find((item) => item.id === jobId) ?? null;
      if (!job || job.status !== "done" || !job.storagePath) return null;
      return {
        bucket: ANALYTICS_EXPORTS_BUCKET,
        path: job.storagePath,
        filename: job.storagePath.split("/").pop() ?? `export-${jobId}`,
      };
    },
  });
}
