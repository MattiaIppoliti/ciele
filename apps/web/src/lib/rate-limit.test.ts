import { describe, expect, it } from "vitest";
import { clientAddress, createRateLimiter, trustedProxyHops } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows up to the limit inside one window", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("a", 10).allowed).toBe(true);
    expect(limiter.check("a", 20).allowed).toBe(true);
    expect(limiter.check("a", 30).allowed).toBe(false);
  });

  it("reports how long until the window resets", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    limiter.check("a", 0);
    expect(limiter.check("a", 400)).toEqual({ allowed: false, retryAfterMs: 600 });
  });

  it("starts a fresh window once the old one expires", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("a", 999).allowed).toBe(false);
    expect(limiter.check("a", 1000).allowed).toBe(true);
  });

  it("budgets each key separately", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("b", 0).allowed).toBe(true);
    expect(limiter.check("a", 0).allowed).toBe(false);
  });

  it("forgets everything on reset", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    limiter.check("a", 0);
    limiter.reset();
    expect(limiter.check("a", 0).allowed).toBe(true);
  });
});

describe("clientAddress", () => {
  it("takes the left-most forwarded hop, the client as the edge saw it", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    expect(clientAddress(headers)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", () => {
    expect(clientAddress(new Headers({ "x-real-ip": "203.0.113.8" }))).toBe(
      "203.0.113.8"
    );
  });

  it("pools unattributable traffic into one bucket rather than exempting it", () => {
    expect(clientAddress(new Headers())).toBe("unknown");
  });

  // The same cases as `client_address_behind` in services/ciele-api.
  it("behind trusted proxies, takes the hop the outermost one added", () => {
    const spoofed = new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.0.0.1" });
    expect(clientAddress(spoofed, 0)).toBe("6.6.6.6");
    expect(clientAddress(spoofed, 1)).toBe("10.0.0.1");
    expect(clientAddress(spoofed, 2)).toBe("203.0.113.7");
    // More hops than entries: the left-most is all there is.
    expect(clientAddress(spoofed, 9)).toBe("6.6.6.6");
    expect(clientAddress(new Headers({ "x-forwarded-for": "203.0.113.7, ", "x-real-ip": "10.0.0.9" }), 1)).toBe(
      "10.0.0.9"
    );
  });

  it("reads CIELE_TRUSTED_PROXY_HOPS as a whole number, anything else as 0", () => {
    expect(trustedProxyHops(undefined)).toBe(0);
    expect(trustedProxyHops("")).toBe(0);
    expect(trustedProxyHops(" 2 ")).toBe(2);
    expect(trustedProxyHops("1x")).toBe(0);
    expect(trustedProxyHops("-1")).toBe(0);
    expect(trustedProxyHops("1.5")).toBe(0);
  });
});
