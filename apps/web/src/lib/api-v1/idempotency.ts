/**
 * `Idempotency-Key` support for /api/v1 mutations (#619).
 *
 * A client that retries a mutation (network blip, timeout) sends the same
 * `Idempotency-Key` header; the first completed response is replayed instead
 * of running the mutation twice. The store is in-process and TTL-bounded —
 * best-effort per instance, which is the right cost for a skeleton: it makes
 * client retries against one server safe, and a durable store can replace
 * this module behind the same function when the API grows multi-instance.
 */

interface StoredResponse {
  status: number;
  body: string;
  expiresAt: number;
}

const TTL_MS = 24 * 60 * 60 * 1000;
const store = new Map<string, StoredResponse>();

function sweep(now: number) {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}

/**
 * Runs `execute` unless this (scope, Idempotency-Key) pair already completed,
 * in which case the recorded response is replayed. No header = no caching.
 * `scope` keeps keys from colliding across routes and tenants — pass
 * something like `"<orgId>:<METHOD /path>"`.
 */
export async function withIdempotency(
  request: Request,
  scope: string,
  execute: () => Promise<Response>
): Promise<Response> {
  const key = request.headers.get("idempotency-key");
  if (!key) return execute();

  const now = Date.now();
  sweep(now);
  const storeKey = `${scope}:${key}`;
  const hit = store.get(storeKey);
  if (hit) {
    return new Response(hit.body, {
      status: hit.status,
      headers: { "content-type": "application/json", "idempotent-replay": "true" },
    });
  }

  const response = await execute();
  // Only successful outcomes are pinned: a failed attempt should be retryable.
  if (response.ok) {
    const body = await response.clone().text();
    store.set(storeKey, { status: response.status, body, expiresAt: now + TTL_MS });
  }
  return response;
}

/** Test hook: drop every recorded response. */
export function clearIdempotencyStore() {
  store.clear();
}

/**
 * A tenant-safe scope for a mutation route: the caller's Authorization
 * header (hashed — the store must never hold a secret) plus the route name,
 * so two Organizations reusing the same Idempotency-Key value never collide.
 */
export async function idempotencyScope(
  request: Request,
  route: string
): Promise<string> {
  const auth = request.headers.get("authorization") ?? "anonymous";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(auth)
  );
  const hex = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
  return `${hex}:${route}`;
}
