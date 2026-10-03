import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withCronAuth } from "./cron-auth";

function request(headers: Record<string, string> = {}) {
  return new Request("https://example.test/api/cron/anything", { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("withCronAuth", () => {
  it("records rejected cron calls without retaining the bearer token or query", async () => {
    vi.stubEnv("CRON_SECRET", "private-secret");
    const response = await withCronAuth(vi.fn())(new Request("https://test/api/cron/run-jobs?secret=private-query", {
      headers: { authorization: "Bearer private-token", "x-vercel-id": "iad1::request-a" },
    }));
    expect(response.status).toBe(401);
    const warnings = vi.mocked(console.warn).mock.calls;
    expect(JSON.parse(warnings[0]![0])).toMatchObject({
      route: "/api/cron/run-jobs", requestId: "iad1::request-a", status: "rejected", statusCode: 401,
    });
    expect(JSON.stringify(warnings)).not.toContain("private");
  });

  it("does not replace a cron handler's exception when logging fails", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const error = new TypeError("original failure");
    vi.mocked(console.error).mockImplementation(() => { throw new Error("sink down"); });
    await expect(withCronAuth(async () => { throw error; })(request({ authorization: "Bearer s3cret" })))
      .rejects.toBe(error);
  });

  it("refuses to run when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const handler = vi.fn();
    const response = await withCronAuth(handler)(
      request({ authorization: "Bearer anything" })
    );
    expect(response.status).toBe(503);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects a missing bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const handler = vi.fn();
    const response = await withCronAuth(handler)(request());
    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects a wrong bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const handler = vi.fn();
    const response = await withCronAuth(handler)(
      request({ authorization: "Bearer wrong" })
    );
    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs the handler when the bearer token matches", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const req = request({ authorization: "Bearer s3cret" });
    const response = await withCronAuth(handler)(req);
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(req);
  });
});
