import { describe, expect, it, vi } from "vitest";
import { type ExportJob } from "@agent-hub/core";
import { getMockDb, DEMO_ORG } from "@agent-hub/db";
import { runDueExportJobs, type ExportRunnerDeps } from "./run-export-jobs";

/**
 * The cron/queue seam, exercised against the in-memory Db so the real
 * claim/lease is under test. The point is idempotency: draining twice must
 * never generate a report for the same job twice.
 */
const db = getMockDb();

function deps(overrides: Partial<ExportRunnerDeps> = {}): ExportRunnerDeps {
  return {
    db,
    render: vi.fn(async () => ({ body: "date\n", format: "csv" as const })),
    store: vi.fn(async (job: ExportJob) => ({
      path: `org/${job.organizationId}/exports/${job.id}.csv`,
    })),
    ...overrides,
  };
}

async function queueJob() {
  return db.createExportJob(DEMO_ORG.id, {
    kind: "insights_overview",
    format: "csv",
    params: {},
  });
}

describe("runDueExportJobs", () => {
  it("generates a queued export once and never re-runs it on the next tick", async () => {
    const job = await queueJob();
    const d = deps();

    const first = await runDueExportJobs(d, { workerId: "w1", limit: 10 });
    expect(first.done).toBeGreaterThanOrEqual(1);

    const store = vi.mocked(d.store);
    const storeCallsForJob = () =>
      store.mock.calls.filter(([j]) => j.id === job.id).length;
    expect(storeCallsForJob()).toBe(1);

    const settled = await db.getExportJob(job.id);
    expect(settled).toMatchObject({
      status: "done",
      storagePath: `org/${DEMO_ORG.id}/exports/${job.id}.csv`,
    });

    // A second overlapping/backstop tick (same spies) must not touch the
    // finished job.
    await runDueExportJobs(d, { workerId: "w2", limit: 10 });
    expect(storeCallsForJob()).toBe(1);
  });

  it("surfaces a failure as error status with a reason after exhausting attempts, then retries", async () => {
    const job = await queueJob();
    const failing = deps({
      render: vi.fn(async () => {
        throw new Error("kaboom");
      }),
    });

    // maxAttempts default is 3: first two runs re-queue, the third is terminal.
    await runDueExportJobs(failing, { workerId: "w", limit: 10 });
    expect((await db.getExportJob(job.id))?.status).toBe("queued");
    await runDueExportJobs(failing, { workerId: "w", limit: 10 });
    await runDueExportJobs(failing, { workerId: "w", limit: 10 });

    const failed = await db.getExportJob(job.id);
    expect(failed?.status).toBe("error");
    expect(failed?.error).toContain("kaboom");

    // Retry re-queues and a healthy run completes it.
    await db.requeueExportJob(job.id);
    await runDueExportJobs(deps(), { workerId: "w", limit: 10 });
    expect((await db.getExportJob(job.id))?.status).toBe("done");
  });
});
