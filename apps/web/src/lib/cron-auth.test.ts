import { afterEach, describe, expect, it, vi } from "vitest";

import { withCronAuth } from "./cron-auth";

function request(headers: Record<string, string> = {}) {
  return new Request("https://example.test/api/cron/anything", { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("withCronAuth", () => {
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
