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

  it("serves the self-host installer without a browser session", async () => {
    // `curl | sh` carries no cookies: behind the auth gate this would pipe a
    // login redirect into the visitor's shell.
    const response = await middleware(
      new NextRequest("https://ciele.example.com/install.sh", { method: "GET" })
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
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

  // Exhaustive on purpose: every route in the (marketing) group, so adding a
  // public page and forgetting to keep it public fails here. /enterprise
  // shipped gated precisely because this test enumerated a subset.
  it("serves every public marketing page without a session", async () => {
    for (const path of [
      "/home",
      "/pricing",
      "/enterprise",
      "/security",
      "/security/gdpr",
      "/security/responsible-disclosure",
      "/policies/privacy",
      "/policies/terms-of-service",
      "/policies/cookies",
      "/policies/dpa",
      "/policies/subprocessors",
      "/features/assistants",
      "/features/flows",
      "/features/insights",
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

  /**
   * The signed-in hint (see lib/auth-hint.ts). The marketing pages are static,
   * so the header's CTA is chosen from this cookie rather than from a server-side
   * session read.
   */
  describe("signed-in hint", () => {
    it("sets the hint once a request arrives with a valid session", async () => {
      mocks.getClaims.mockResolvedValueOnce({
        data: { claims: { sub: "user-1" } },
      } as never);

      const response = await middleware(
        new NextRequest("https://ciele.example.com/home")
      );

      expect(response.cookies.get("ciele_signed_in")?.value).toBe("1");
    });

    it("clears a stale hint when the session has gone", async () => {
      // Session expired since the hint was written: the header must stop
      // offering "Open app".
      const request = new NextRequest("https://ciele.example.com/home");
      request.cookies.set("ciele_signed_in", "1");

      const response = await middleware(request);

      expect(response.cookies.get("ciele_signed_in")?.value).toBe("");
    });

    it("writes nothing when the hint already agrees, so the response stays cacheable", async () => {
      // A Set-Cookie header stops a CDN caching an otherwise-static page, which
      // would undo the prerendering the hint exists to enable. In the steady
      // state — nearly every request — there must be no cookie write at all.
      const signedOut = await middleware(
        new NextRequest("https://ciele.example.com/home")
      );
      expect(signedOut.headers.get("set-cookie")).toBeNull();

      mocks.getClaims.mockResolvedValueOnce({
        data: { claims: { sub: "user-1" } },
      } as never);
      const request = new NextRequest("https://ciele.example.com/home");
      request.cookies.set("ciele_signed_in", "1");
      const signedIn = await middleware(request);
      expect(signedIn.headers.get("set-cookie")).toBeNull();
    });

    it("treats demo mode as signed in, as every other seam does", async () => {
      // With no Supabase configured there is no auth at all and the mock db
      // hands out a session, so the marketing header must offer "Open app". The
      // hint has to say the same or the demo build would invite a sign-in that
      // means nothing.
      vi.unstubAllEnvs();

      const response = await middleware(
        new NextRequest("https://ciele.example.com/home")
      );

      expect(response.cookies.get("ciele_signed_in")?.value).toBe("1");
    });

    it("is readable by the inline script, so never HttpOnly", async () => {
      // The whole point is that a static page's own JavaScript can read it
      // before first paint; HttpOnly would make it invisible.
      mocks.getClaims.mockResolvedValueOnce({
        data: { claims: { sub: "user-1" } },
      } as never);

      const response = await middleware(
        new NextRequest("https://ciele.example.com/home")
      );

      expect(response.cookies.get("ciele_signed_in")?.httpOnly).toBeFalsy();
    });
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
