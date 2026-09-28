import type { ApiKeyContext } from "@/lib/api-v1/auth";
import { apiRateLimited } from "@/lib/api-v1/http";
import { createRateLimiter } from "@/lib/rate-limit";

/**
 * The named 429 budgets a v1 endpoint can declare in the OpenAPI registry
 * (`rateLimited` in `openapi.ts`). The registry and the routes pick from this
 * one list, but nothing ties a route to its own entry: the route enforces the
 * budget itself (`perKeyThrottle` below, `source-intake.ts` for ingestion).
 */
export type ApiRateLimitName = "source-ingestion" | "knowledge-search" | "assistant-ask";

/**
 * A `throttle` for `runApiOperation`: `limit` calls per key per minute, for an
 * operation that spends money on every call.
 *
 * Per key **per instance**: the limiter is `rate-limit.ts`'s in-process map,
 * so a fleet of warm instances admits up to `limit × instances`. A key is
 * never refused below `limit`, which is what the docs promise. The shared
 * ceiling on model turns is the runtime's Postgres-backed concurrency
 * admission (`packages/agent/src/turn-concurrency.ts`), not this.
 */
export function perKeyThrottle(
  name: Exclude<ApiRateLimitName, "source-ingestion">,
  { limit, message }: { limit: number; message: string }
): (ctx: ApiKeyContext) => Response | null {
  const limiter = createRateLimiter({ limit, windowMs: 60_000 });
  return (ctx) => {
    const decision = limiter.check(`${name}:${ctx.keyId}`);
    if (decision.allowed) return null;
    return apiRateLimited(message, decision.retryAfterMs);
  };
}
