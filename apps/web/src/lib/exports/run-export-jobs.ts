import type { ExportJob, ExportJobFormat } from "@agent-hub/core";
import { thrownMessage } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";

/**
 * How long a claimed export may run before another tick may reclaim it. A
 * crashed run stays `running` until its lock ages past this, then the next
 * cron tick re-leases it — the durable counterpart to the request-path
 * acceleration.
 */
export const EXPORT_JOB_LEASE_MS = 5 * 60_000;

export interface ExportArtifact {
  body: string;
  format: ExportJobFormat;
}

export interface ExportRunnerDeps {
  db: Db;
  /** Builds the artifact body for a claimed job (RLS-agnostic worker input). */
  render(job: ExportJob): Promise<ExportArtifact>;
  /** Persists the artifact and returns its object-storage path. */
  store(job: ExportJob, artifact: ExportArtifact): Promise<{ path: string }>;
}

export interface RunExportJobsResult {
  claimed: number;
  done: number;
  failed: number;
  retried: number;
}

async function runClaimedExportJob(
  job: ExportJob,
  deps: ExportRunnerDeps
): Promise<"done" | "failed" | "retried"> {
  try {
    const artifact = await deps.render(job);
    const { path } = await deps.store(job, artifact);
    await deps.db.updateExportJob(job.id, {
      status: "done",
      error: "",
      storagePath: path,
      lockedAt: null,
      lockedBy: null,
    });
    return "done";
  } catch (error) {
    const message = thrownMessage(error, "Export generation failed");
    // `attempts` already reflects this run (claim increments it). Terminal
    // once the attempt budget is spent; otherwise re-queue for another tick.
    if (job.attempts >= job.maxAttempts) {
      await deps.db.updateExportJob(job.id, {
        status: "error",
        error: message,
        lockedAt: null,
        lockedBy: null,
      });
      return "failed";
    }
    await deps.db.updateExportJob(job.id, {
      status: "queued",
      error: message,
      lockedAt: null,
      lockedBy: null,
    });
    return "retried";
  }
}

/**
 * Drains a bounded batch of due export jobs. Claiming stamps the running
 * status + lock atomically, so overlapping ticks never double-run a job:
 * running, non-stale jobs are simply not returned by the next claim.
 */
export async function runDueExportJobs(
  deps: ExportRunnerDeps,
  { workerId, limit }: { workerId: string; limit: number }
): Promise<RunExportJobsResult> {
  const now = new Date();
  const claimed = await deps.db.claimDueExportJobs({
    workerId,
    now: now.toISOString(),
    staleBefore: new Date(now.getTime() - EXPORT_JOB_LEASE_MS).toISOString(),
    limit,
  });

  let done = 0;
  let failed = 0;
  let retried = 0;
  for (const job of claimed) {
    const outcome = await runClaimedExportJob(job, deps);
    if (outcome === "done") done++;
    else if (outcome === "failed") failed++;
    else retried++;
  }
  return { claimed: claimed.length, done, failed, retried };
}
