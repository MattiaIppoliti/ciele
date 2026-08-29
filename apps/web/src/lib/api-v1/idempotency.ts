/** Durable, multi-instance `Idempotency-Key` support for API v1 mutations. */

import { getApiV1Db } from "@/lib/api-v1/db";
import { apiError } from "@/lib/api-v1/http";

const TTL_MS = 24 * 60 * 60 * 1000;
const STALE_AFTER_MS = 10 * 60 * 1000;
const MAX_KEY_CHARS = 200;
let testNamespace = 0;

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

/** Call before consuming the body when a route wants payload conflict detection. */
export async function idempotencyRequestHash(request: Request): Promise<string> {
  const body = await request.clone().text().catch(() => "");
  const url = new URL(request.url);
  return sha256(`${request.method}\n${url.pathname}\n${body}`);
}

export async function withIdempotency(
  request: Request,
  scope: string,
  execute: () => Promise<Response>,
  suppliedRequestHash?: string
): Promise<Response> {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key) return execute();
  if (key.length > MAX_KEY_CHARS) {
    return apiError(400, "invalid_idempotency_key", "Idempotency-Key is too long");
  }

  const now = new Date();
  const requestHash = suppliedRequestHash ?? (await idempotencyRequestHash(request));
  const durableScope =
    process.env.NODE_ENV === "test" ? `test-${testNamespace}:${scope}` : scope;
  let claim;
  try {
    claim = await getApiV1Db().claimApiIdempotency({
      scope: durableScope,
      key,
      requestHash,
      now: now.toISOString(),
      staleBefore: new Date(now.getTime() - STALE_AFTER_MS).toISOString(),
      expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
    });
  } catch {
    return apiError(503, "idempotency_unavailable", "Idempotency storage is unavailable");
  }

  if (claim.status === "conflict") {
    return apiError(409, "idempotency_conflict", "This key was used with a different request");
  }
  if (claim.status === "running") {
    return new Response(
      JSON.stringify({ error: { code: "request_in_progress", message: "This request is already running" } }),
      { status: 409, headers: { "content-type": "application/json", "retry-after": "2" } }
    );
  }
  if (claim.status === "completed") {
    return new Response(claim.responseBody, {
      status: claim.responseStatus,
      headers: {
        "content-type": claim.contentType,
        "idempotent-replay": "true",
      },
    });
  }
  if (claim.status !== "claimed") {
    return apiError(500, "idempotency_state_error", "Unexpected idempotency state");
  }
  const leaseToken = claim.leaseToken;

  let response: Response;
  try {
    response = await execute();
  } catch {
    response = apiError(
      500,
      "mutation_failed",
      "The mutation failed; this idempotency key will not be executed again"
    );
  }

  const responseBody = await response.clone().text();
  const completed = await getApiV1Db()
    .completeApiIdempotency({
      scope: durableScope,
      key,
      leaseToken,
      responseStatus: response.status,
      responseBody,
      contentType: response.headers.get("content-type") ?? "application/json",
      now: new Date().toISOString(),
    })
    .catch(() => false);
  if (!completed) {
    return apiError(503, "idempotency_commit_failed", "The mutation completed but its replay record could not be committed");
  }
  return response;
}

/** Test hook: isolate subsequent cases without a production delete API. */
export function clearIdempotencyStore() {
  testNamespace += 1;
}

export async function idempotencyScope(request: Request, route: string): Promise<string> {
  const auth = request.headers.get("authorization") ?? "anonymous";
  return `${await sha256(auth)}:${route}`;
}
