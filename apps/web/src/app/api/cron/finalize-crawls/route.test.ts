import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@agent-hub/db";

const mocks = vi.hoisted(() => ({
  finalizeDueCrawls: vi.fn(),
}));

const widgetDb = { marker: "widget-db" } as unknown as Db;

vi.mock("@/lib/widget-db", () => ({ getWidgetDb: () => widgetDb }));

vi.mock("@agent-hub/agent", () => ({ finalizeDueCrawls: mocks.finalizeDueCrawls }));

import { GET } from "./route";

/**
 * The route is an adapter: cron auth in, the drain's report out. What a tick
 * does — draining the job ledger, then claiming and finalizing a bounded batch
 * of in-flight crawls — lives in `@agent-hub/agent` (`finalizeDueCrawls`) and is
 * tested there. Here we only prove the wrapper.
 */

const NO_JOBS = { claimed: 0, succeeded: 0, failed: 0, retried: 0 };

const authed = () =>
  new Request("https://ciele.app/api/cron/finalize-crawls", {
    headers: { authorization: "Bearer cron-secret" },
  });

describe("GET /api/cron/finalize-crawls", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
    mocks.finalizeDueCrawls.mockReset();
    mocks.finalizeDueCrawls.mockResolvedValue({
      jobs: NO_JOBS,
      graphSync: NO_JOBS,
      proposals: NO_JOBS,
      crawls: { swept: 0, settled: 0, results: [] },
    });
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it("refuses to run when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(authed());
    expect(response.status).toBe(503);
    expect(mocks.finalizeDueCrawls).not.toHaveBeenCalled();
  });

  it("runs the finalizer against the service-role Db and serializes its report", async () => {
    const report = {
      jobs: { claimed: 1, succeeded: 1, failed: 0, retried: 0 },
      graphSync: NO_JOBS,
      proposals: NO_JOBS,
      crawls: {
        swept: 2,
        settled: 1,
        results: [
          { sourceId: "a", status: "ready" },
          { sourceId: "b", status: "processing" },
        ],
      },
    };
    mocks.finalizeDueCrawls.mockResolvedValue(report);

    const response = await GET(authed());

    // The cron finalizer spans every org, so it must run on the service-role Db.
    expect(mocks.finalizeDueCrawls).toHaveBeenCalledWith({ db: widgetDb });
    await expect(response.json()).resolves.toEqual(report);
  });
});
