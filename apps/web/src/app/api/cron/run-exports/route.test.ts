import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  drainDueExportJobs: vi.fn(),
}));

vi.mock("@/lib/exports/drain", () => ({
  EXPORT_JOB_BATCH_SIZE: 5,
  drainDueExportJobs: mocks.drainDueExportJobs,
}));

import { GET } from "./route";

describe("GET /api/cron/run-exports", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
    mocks.drainDueExportJobs.mockReset();
    mocks.drainDueExportJobs.mockResolvedValue({
      claimed: 2,
      done: 2,
      failed: 0,
      retried: 0,
    });
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it("rejects a request without the cron secret", async () => {
    const response = await GET(
      new Request("https://ciele.app/api/cron/run-exports")
    );
    expect(response.status).toBe(401);
    expect(mocks.drainDueExportJobs).not.toHaveBeenCalled();
  });

  it("503s when the cron secret is not configured", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(
      new Request("https://ciele.app/api/cron/run-exports", {
        headers: { authorization: "Bearer cron-secret" },
      })
    );
    expect(response.status).toBe(503);
    expect(mocks.drainDueExportJobs).not.toHaveBeenCalled();
  });

  it("drains a bounded batch when authorized", async () => {
    const response = await GET(
      new Request("https://ciele.app/api/cron/run-exports", {
        headers: { authorization: "Bearer cron-secret" },
      })
    );
    expect(mocks.drainDueExportJobs).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, workerId: "cron-run-exports" })
    );
    await expect(response.json()).resolves.toMatchObject({
      exports: { claimed: 2, done: 2 },
    });
  });
});
