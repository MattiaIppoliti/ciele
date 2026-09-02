import { describe, expect, it } from "vitest";
import { internalApiOrigin } from "./internal-origin";

/**
 * CYB-01's sibling in #801: the hosted MCP endpoint forwards a live API key to
 * this origin, so the property under test is that no request-controlled value
 * can ever become it. Every case below is a function of the environment only.
 */
describe("internalApiOrigin", () => {
  it("prefers the operator's explicit internal origin", () => {
    expect(
      internalApiOrigin({
        CIELE_INTERNAL_API_ORIGIN: "http://app.internal:3000",
        VERCEL_URL: "preview.vercel.app",
        NEXT_PUBLIC_APP_URL: "https://ciele.app",
      }),
    ).toBe("http://app.internal:3000");
  });

  it("uses the running Vercel deployment before the configured public origin", () => {
    // A preview must call its own code, not production's.
    expect(
      internalApiOrigin({
        VERCEL_URL: "ciele-abc123.vercel.app",
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_APP_URL: "https://ciele.app",
      }),
    ).toBe("https://ciele-abc123.vercel.app");
  });

  it("in Vercel production prefers the canonical origin over the deployment URL", () => {
    // With Deployment Protection on, the `*.vercel.app` deployment URL answers
    // with the SSO interstitial, so a self-call there never reaches /api/v1;
    // the canonical production origin is the one the protection exempts
    // (#801 review, CYB-03).
    expect(
      internalApiOrigin({
        VERCEL_ENV: "production",
        VERCEL_URL: "ciele-abc123.vercel.app",
        NEXT_PUBLIC_APP_URL: "https://ciele.app",
      }),
    ).toBe("https://ciele.app");
    // Nothing canonical configured: the deployment URL is still the best answer.
    expect(
      internalApiOrigin({ VERCEL_ENV: "production", VERCEL_URL: "ciele-abc123.vercel.app" }),
    ).toBe("https://ciele-abc123.vercel.app");
  });

  it("falls back to the configured public origin", () => {
    expect(
      internalApiOrigin({ NEXT_PUBLIC_APP_URL: "https://ciele.app/" }),
    ).toBe("https://ciele.app");
  });

  it("falls back to loopback on the serving port, so self-host needs no config", () => {
    expect(internalApiOrigin({ PORT: "8080" })).toBe("http://127.0.0.1:8080");
    expect(internalApiOrigin({})).toBe("http://127.0.0.1:3000");
  });

  it("ignores a malformed, non-HTTP, or credential-bearing origin", () => {
    for (const bad of [
      "not-a-url",
      "evil.example.com",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://user:pass@evil.example.com",
      "",
    ]) {
      expect(internalApiOrigin({ CIELE_INTERNAL_API_ORIGIN: bad, PORT: "3000" })).toBe(
        "http://127.0.0.1:3000",
      );
    }
  });

  it("ignores a non-numeric PORT rather than building a broken origin", () => {
    expect(internalApiOrigin({ PORT: "$PORT" })).toBe("http://127.0.0.1:3000");
  });
});
