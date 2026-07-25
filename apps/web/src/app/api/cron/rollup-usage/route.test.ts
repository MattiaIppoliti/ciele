import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rollupUsageDaily: vi.fn(),
}));

vi.mock("@/lib/widget-db", () => ({
  getWidgetDb: () => ({ rollupUsageDaily: mocks.rollupUsageDaily }),
}));

import { GET, ROLLUP_WINDOW_DAYS } from "./route";

describe("GET /api/cron/rollup-usage", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
    mocks.rollupUsageDaily.mockReset();
    mocks.rollupUsageDaily.mockResolvedValue(4);
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it("rejects a request without the cron secret", async () => {
    const response = await GET(
      new Request("https://ciele.app/api/cron/rollup-usage")
    );
    expect(response.status).toBe(401);
    expect(mocks.rollupUsageDaily).not.toHaveBeenCalled();
  });

  it("503s when the cron secret is not configured", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(
      new Request("https://ciele.app/api/cron/rollup-usage", {
        headers: { authorization: "Bearer cron-secret" },
      })
    );
    expect(response.status).toBe(503);
    expect(mocks.rollupUsageDaily).not.toHaveBeenCalled();
  });

  it("rolls up the bounded window when authorized", async () => {
    const response = await GET(
      new Request("https://ciele.app/api/cron/rollup-usage", {
        headers: { authorization: "Bearer cron-secret" },
      })
    );
    expect(mocks.rollupUsageDaily).toHaveBeenCalledWith(ROLLUP_WINDOW_DAYS);
    await expect(response.json()).resolves.toEqual({
      upserted: 4,
      windowDays: ROLLUP_WINDOW_DAYS,
    });
  });
});
