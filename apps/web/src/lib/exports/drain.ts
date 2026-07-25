import { getWidgetDb } from "@/lib/widget-db";
import {
  createSupabaseServiceClient,
  isSupabaseServiceConfigured,
} from "@/lib/supabase/service";
import { renderExportArtifact, storeExportArtifact } from "./artifacts";
import { runDueExportJobs, type RunExportJobsResult } from "./run-export-jobs";

/** Bounded per tick: generation reads the reporting layer and writes storage;
 *  leftovers wait for the next tick. */
export const EXPORT_JOB_BATCH_SIZE = 5;

/**
 * Wires the real render (reporting layer) + store (private bucket) into the
 * worker and drains a bounded batch. Shared by the cron backstop and the
 * request-path `after()` acceleration; both go through the same durable job
 * ledger, so running from either place is safe. A no-op when object storage
 * is not configured (offline demo).
 */
export async function drainDueExportJobs(input?: {
  workerId?: string;
  limit?: number;
}): Promise<RunExportJobsResult | { skipped: string }> {
  if (!isSupabaseServiceConfigured()) {
    return { skipped: "storage not configured" };
  }
  const client = createSupabaseServiceClient();
  const db = getWidgetDb();
  return runDueExportJobs(
    {
      db,
      render: (job) => renderExportArtifact(client, job),
      store: (job, artifact) => storeExportArtifact(client, job, artifact),
    },
    {
      workerId: input?.workerId ?? `run-exports-${crypto.randomUUID()}`,
      limit: input?.limit ?? EXPORT_JOB_BATCH_SIZE,
    }
  );
}
