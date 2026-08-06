import { describe, expect, it } from "vitest";
import { clientAddress, createRateLimiter } from "./rate-limit";

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
  it("takes the left-most forwarded hop — the client as the edge saw it", () => {
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
});
