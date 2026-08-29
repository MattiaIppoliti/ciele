import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@agent-hub/db";

const mocks = vi.hoisted(() => ({
  runDueRoutines: vi.fn(),
}));

const widgetDb = { marker: "widget-db" } as unknown as Db;

vi.mock("@/lib/widget-db", () => ({ getWidgetDb: () => widgetDb }));

vi.mock("@agent-hub/agent", () => ({ runDueRoutines: mocks.runDueRoutines }));

import { GET } from "./route";

/**
 * The route is an adapter: cron auth in, the drain's report out. When a routine
 * is due and what happens when it runs lives in `@agent-hub/agent`
 * (`runDueRoutines`) and is tested there. Here we only prove the wrapper.
 */

const authed = () =>
  new Request("https://ciele.app/api/cron/run-routines", {
    headers: { authorization: "Bearer cron-secret" },
  });

describe("GET /api/cron/run-routines", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
    mocks.runDueRoutines.mockReset();
    mocks.runDueRoutines.mockResolvedValue({
      candidates: 0,
      ran: 0,
      failed: 0,
      deferred: 0,
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
    expect(mocks.runDueRoutines).not.toHaveBeenCalled();
  });

  it("runs the drain on the service-role Db and hands over the action port", async () => {
    const report = { candidates: 3, ran: 2, failed: 1, deferred: 0 };
    mocks.runDueRoutines.mockResolvedValue(report);

    const response = await GET(authed());

    // Unattended runs span every org, so the drain needs the service-role Db.
    // The action port (#770) is what turns grant rows into tools: the runtime
    // does not know operations exist, so it arrives from here.
    expect(mocks.runDueRoutines).toHaveBeenCalledWith({
      db: widgetDb,
      teammateActions: expect.any(Function),
    });
    await expect(response.json()).resolves.toEqual(report);
  });
});
