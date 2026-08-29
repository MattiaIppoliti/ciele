import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@agent-hub/db";

const mocks = vi.hoisted(() => ({
  sweepDueRecrawls: vi.fn(),
}));

const widgetDb = { marker: "widget-db" } as unknown as Db;

vi.mock("@/lib/widget-db", () => ({ getWidgetDb: () => widgetDb }));

vi.mock("@agent-hub/agent", () => ({ sweepDueRecrawls: mocks.sweepDueRecrawls }));

import { GET } from "./route";

/**
 * The route is an adapter: cron auth in, the drain's report out. What a tick
 * does lives in `@agent-hub/agent` (`sweepDueRecrawls`) and is tested there,
 * batch bounding, claim semantics and per-Source error reporting in
 * `scheduled.test.ts`, the real provider lifecycle in
 * `recrawl.scheduled.test.ts`. Here we only prove the wrapper.
 */

const authed = () =>
  new Request("https://ciele.app/api/cron/sweep-recrawls", {
    headers: { authorization: "Bearer cron-secret" },
  });

describe("GET /api/cron/sweep-recrawls", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
    mocks.sweepDueRecrawls.mockReset();
    mocks.sweepDueRecrawls.mockResolvedValue({
      recrawls: { swept: 0, launched: 0, results: [] },
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
    expect(mocks.sweepDueRecrawls).not.toHaveBeenCalled();
  });

  it("rejects a request without the cron bearer token", async () => {
    const response = await GET(
      new Request("https://ciele.app/api/cron/sweep-recrawls")
    );
    expect(response.status).toBe(401);
    expect(mocks.sweepDueRecrawls).not.toHaveBeenCalled();
  });

  it("runs the sweep against the service-role Db and serializes its report", async () => {
    const report = {
      recrawls: {
        swept: 2,
        launched: 1,
        results: [
          { sourceId: "ok", status: "processing" },
          { sourceId: "boom", status: "error", message: "Not found" },
        ],
      },
    };
    mocks.sweepDueRecrawls.mockResolvedValue(report);

    const response = await GET(authed());

    // The cron sweep spans every org, so it must run on the service-role Db.
    expect(mocks.sweepDueRecrawls).toHaveBeenCalledWith({ db: widgetDb });
    await expect(response.json()).resolves.toEqual(report);
  });
});
