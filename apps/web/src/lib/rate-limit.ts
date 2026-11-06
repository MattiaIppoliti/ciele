/**
 * A fixed-window, in-process rate limiter.
 *
 * Built for the one thing this app exposes without a session, the public
 * contact-sales Server Action. It is deliberately the smallest useful thing:
 * a `Map` of window counters, no Redis, no table, no network hop on the hot
 * path.
 *
 * What that buys and what it does not: on a serverless runtime each instance
 * keeps its own map, so a determined attacker spread across warm instances
 * gets `limit × instances` rather than `limit`. That still turns a trivial
 * flood into work, and it is paired with a honeypot and hard field ceilings
 * (see `lib/contact/sales-lead.ts`) rather than relied on alone. Move to a
 * shared store when there is a second caller that needs a real global budget.
 *
 * `now` is a parameter, not a `Date.now()` call inside; that is what makes
 * the window behaviour testable without sleeping.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Milliseconds until the caller's window resets. `0` when allowed. */
  retryAfterMs: number;
}

export interface RateLimiter {
  check(key: string, now?: number): RateLimitDecision;
  /** Test seam: forget every window. */
  reset(): void;
}

interface Window {
  count: number;
  /** Epoch ms at which this window expires. */
  expiresAt: number;
}

/** Bound the map so a spray of unique keys cannot grow it without limit. */
const MAX_TRACKED_KEYS = 10_000;

export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
}): RateLimiter {
  const { limit, windowMs } = options;
  const windows = new Map<string, Window>();

  function prune(now: number) {
    for (const [key, window] of windows) {
      if (window.expiresAt <= now) windows.delete(key);
    }
  }

  return {
    check(key, now = Date.now()) {
      const existing = windows.get(key);
      if (!existing || existing.expiresAt <= now) {
        if (windows.size >= MAX_TRACKED_KEYS) prune(now);
        // Still full of live windows: fail closed rather than grow unbounded.
        if (windows.size >= MAX_TRACKED_KEYS) {
          return { allowed: false, retryAfterMs: windowMs };
        }
        windows.set(key, { count: 1, expiresAt: now + windowMs });
        return { allowed: true, retryAfterMs: 0 };
      }
      if (existing.count >= limit) {
        return { allowed: false, retryAfterMs: existing.expiresAt - now };
      }
      existing.count += 1;
      return { allowed: true, retryAfterMs: 0 };
    },
    reset() {
      windows.clear();
    },
  };
}

/**
 * `CIELE_TRUSTED_PROXY_HOPS`: how many proxies in front of this app append to
 * `x-forwarded-for`. Unset or 0 (anything but a whole number reads as 0) is
 * the default and right on Vercel, whose edge overwrites the header, and
 * behind the bundled Caddy, which replaces what an untrusted client sent.
 * `services/ciele-api` reads the same variable the same way.
 */
export function trustedProxyHops(value: string | undefined = process.env.CIELE_TRUSTED_PROXY_HOPS): number {
  const trimmed = (value ?? "").trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : 0;
}

/**
 * The caller's address, as far as we can tell behind the proxy. With no
 * trusted proxies it takes the left-most `x-forwarded-for` hop (the client as
 * the edge saw it). Behind N proxies that each append the address they were
 * called from, a client can write anything on the left, so it takes the Nth
 * hop from the right, the one the outermost trusted proxy added. Then
 * `x-real-ip`, then a shared bucket, which is intentional: unattributable
 * traffic competes for one budget instead of getting an unlimited one each.
 */
export function clientAddress(headers: Headers, hops: number = trustedProxyHops()): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",");
  const hop = forwarded?.[hops > 0 ? Math.max(0, forwarded.length - hops) : 0]?.trim();
  return hop || headers.get("x-real-ip")?.trim() || "unknown";
}
