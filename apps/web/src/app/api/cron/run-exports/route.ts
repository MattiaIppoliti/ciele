import { withCronAuth } from "@/lib/cron-auth";
import { drainDueExportJobs, EXPORT_JOB_BATCH_SIZE } from "@/lib/exports/drain";

/**
 * Durable backstop for report exports (ADR-0010): drains a bounded batch of
 * due export jobs, generating each report off the request path and writing the
 * artifact to the private analytics-exports bucket. The request-path `after()`
 * acceleration handles the common "admin just clicked Export" case; this is the
 * recovery tick for jobs that never got picked up or whose run crashed.
 *
 * Scheduled daily in vercel.json (deployment-plan cron limit). Protected by
 * CRON_SECRET (sent as a Bearer token); without the secret configured we
 * refuse to run. Claiming leases each job, so overlapping ticks never
 * double-run one.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withCronAuth(async () => {
  const exports = await drainDueExportJobs({
    workerId: "cron-run-exports",
    limit: EXPORT_JOB_BATCH_SIZE,
  });
  return Response.json({ exports });
});
