import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(async () => ({ data: { claims: null } })),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getClaims: mocks.getClaims },
  }),
}));

import { middleware } from "./middleware";

describe("middleware local connector relay", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows a paired connector to exchange its one-time code without browser cookies", async () => {
    const response = await middleware(
      new NextRequest(
        "https://ciele.example.com/api/local-connector/relay/exchange",
        { method: "POST" }
      )
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });

  it("lets the paired connector poll relay jobs without browser cookies", async () => {
    for (const method of ["POST", "PATCH"]) {
      const response = await middleware(
        new NextRequest(
          "https://ciele.example.com/api/local-connector/relay/jobs",
          { method }
        )
      );

      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("serves the connector runtime without a browser session", async () => {
    const response = await middleware(
      new NextRequest(
        "https://ciele.example.com/api/local-connector/runtime",
        { method: "GET" }
      )
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });

  it("serves the terminal install script without a browser session", async () => {
    for (const shell of ["sh", "ps1"]) {
      const response = await middleware(
        new NextRequest(
          `https://ciele.example.com/api/local-connector/install/${shell}`,
          { method: "GET" }
        )
      );

      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("lets an anonymous visitor reach the widget SSO routes (not the admin login)", async () => {
    for (const path of [
      "/api/sso/entra/start?assistantId=a1",
      "/api/sso/entra/callback?code=c&state=s",
      "/api/sso/entra/logout",
    ]) {
      const response = await middleware(
        new NextRequest(`https://ciele.example.com${path}`)
      );
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("sends a signed-out visitor on the root to the marketing home", async () => {
    const response = await middleware(
      new NextRequest("https://ciele.example.com/")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://ciele.example.com/home"
    );
  });

  it("serves the marketing home without a session", async () => {
    const response = await middleware(
      new NextRequest("https://ciele.example.com/home")
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });

  it("serves every public marketing page without a session", async () => {
    for (const path of [
      "/security",
      "/security/gdpr",
      "/security/responsible-disclosure",
      "/policies/privacy",
      "/policies/terms-of-service",
      "/pricing",
      "/enterprise",
      "/features/flows",
      "/api/cookie-consent",
    ]) {
      const response = await middleware(
        new NextRequest(`https://ciele.example.com${path}`)
      );

      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("lets an authenticated user view the marketing home", async () => {
    mocks.getClaims.mockResolvedValueOnce({
      data: { claims: { sub: "user-1" } },
    } as never);

    const response = await middleware(
      new NextRequest("https://ciele.example.com/home")
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });

  it("keeps the root as the app for an authenticated user", async () => {
    mocks.getClaims.mockResolvedValueOnce({
      data: { claims: { sub: "user-1" } },
    } as never);

    const response = await middleware(
      new NextRequest("https://ciele.example.com/")
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });

  it("still requires a browser session for the relay pairing-code endpoint", async () => {
    const response = await middleware(
      new NextRequest("https://ciele.example.com/api/local-connector/relay/pair", {
        method: "POST",
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://ciele.example.com/login?next=%2Fapi%2Flocal-connector%2Frelay%2Fpair"
    );
  });
});
