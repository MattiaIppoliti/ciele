import { createServerClient } from "@supabase/ssr";
import { describe, expect, it, vi } from "vitest";
import { withTransientRetry } from "./transient-retry";

const READ =
  "https://project.supabase.co/rest/v1/organization_members?select=role";
const AUTH = "https://project.supabase.co/auth/v1/token";
const RPC = "https://project.supabase.co/rest/v1/rpc/get_insights_overview";

const reply = (status: number) =>
  new Response(status === 200 ? "[]" : "", { status });

/** No delay in tests: the wait is the fix's only slow part and adds nothing here. */
const wrap = (inner: ReturnType<typeof vi.fn>) =>
  withTransientRetry(inner as unknown as typeof fetch, 0);

describe("withTransientRetry", () => {
  it("retries the transient 401 that blanks the console, and returns the retry", async () => {
    const inner = vi
      .fn()
      .mockResolvedValueOnce(reply(401))
      .mockResolvedValueOnce(reply(200));

    const response = await wrap(inner)(READ);

    expect(response.status).toBe(200);
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("retries once and no more, so a session that is genuinely gone still 401s", async () => {
    const inner = vi.fn().mockResolvedValue(reply(401));

    const response = await wrap(inner)(READ);

    expect(response.status).toBe(401);
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("leaves writes alone: a replayed mutation is worse than a failed render", async () => {
    const inner = vi.fn().mockResolvedValue(reply(401));

    const response = await wrap(inner)(READ, { method: "POST", body: "{}" });

    expect(response.status).toBe(401);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("leaves RPC alone, since a POST to /rpc/ may well write", async () => {
    const inner = vi.fn().mockResolvedValue(reply(401));

    const response = await wrap(inner)(RPC, { method: "POST" });

    expect(response.status).toBe(401);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("leaves the auth endpoints alone, where a 401 is the real answer", async () => {
    const inner = vi.fn().mockResolvedValue(reply(401));

    const response = await wrap(inner)(AUTH);

    expect(response.status).toBe(401);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("retries a HEAD, which is how the alert badge counts rows", async () => {
    const inner = vi
      .fn()
      .mockResolvedValueOnce(reply(401))
      .mockResolvedValueOnce(reply(200));

    const response = await wrap(inner)(READ, { method: "HEAD" });

    expect(response.status).toBe(200);
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("passes a healthy read straight through", async () => {
    const inner = vi.fn().mockResolvedValue(reply(200));

    const response = await wrap(inner)(READ);

    expect(response.status).toBe(200);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("does not retry other failures: a 500 is not this bug", async () => {
    const inner = vi.fn().mockResolvedValue(reply(500));

    const response = await wrap(inner)(READ);

    expect(response.status).toBe(500);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("accepts a Request object, the other shape supabase-js may call with", async () => {
    const inner = vi
      .fn()
      .mockResolvedValueOnce(reply(401))
      .mockResolvedValueOnce(reply(200));

    const response = await wrap(inner)(new Request(READ));

    expect(response.status).toBe(200);
    expect(inner).toHaveBeenCalledTimes(2);
  });
});

/**
 * The wrapper is only worth anything if `global.fetch` actually reaches
 * PostgREST, so this drives the real client the way the failing render did:
 * the exact query that 401'd in production, through the option server.ts sets.
 */
describe("the wiring the admin render depends on", () => {
  it("hands getCurrentOrg's query a row instead of the 401 that blanked the app", async () => {
    const inner = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ role: "owner" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

    const client = createServerClient("https://project.supabase.co", "anon", {
      global: { fetch: withTransientRetry(inner as unknown as typeof fetch, 0) },
      cookies: { getAll: () => [], setAll: () => {} },
    });

    const { data, error } = await client
      .from("organization_members")
      .select("role");

    expect(error).toBeNull();
    expect(data).toEqual([{ role: "owner" }]);
    expect(inner).toHaveBeenCalledTimes(2);
  });
});
