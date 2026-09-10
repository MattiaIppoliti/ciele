import { NextRequest } from "next/server";
import { deliverWebhookCallback, verifyWebhookCallbackToken } from "@agent-hub/agent";
import { clientAddress, createRateLimiter } from "@/lib/rate-limit";
import { getServiceRoleDb } from "@/lib/service-db";

export const runtime = "nodejs";

/**
 * The callback an `http_webhook` step is waiting for (#842).
 *
 * Unauthenticated by construction, since the other system holds a URL and not
 * an account, so the signed token in `?t=` is the entire authorization. It names
 * one subscription and carries that subscription's own expiry inside the
 * signed material, which is what stops a URL found in someone's logs from
 * being useful later.
 *
 * Every answer here is deliberately shallow. A caller that guesses an id, or
 * replays a token, learns whether the *token* was good and nothing else about
 * whether that subscription exists, belongs to anyone, or is still open.
 */

// Generous, because a legitimate system may retry: what this stops is a spray
// of guesses, not a caller answering twice. Keyed by the caller's address, not
// by the id in the URL: a limiter keyed by subscription id would hand a
// guesser a fresh budget per guess, which is no limit at all.
const limiter = createRateLimiter({ limit: 120, windowMs: 60_000 });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ subscriptionId: string }> }
) {
  const { subscriptionId } = await params;
  const token = new URL(request.url).searchParams.get("t") ?? "";

  const decision = limiter.check(`webhook:${clientAddress(request.headers)}`);
  if (!decision.allowed) {
    return Response.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil(decision.retryAfterMs / 1000)) },
      }
    );
  }

  const verdict = verifyWebhookCallbackToken(token);
  // A bad token and a token for a different subscription are one answer: the
  // id in the URL is only trusted once the signature says it may be.
  if (!verdict.ok || verdict.subscriptionId !== subscriptionId) {
    return Response.json({ error: "invalid_token" }, { status: 401 });
  }

  // Not capped here: `receiveWebhook` in core decides what a stored payload
  // is, and a second limit in the route is a second thing to keep in step.
  const body = await request.text();
  // The service Db: this table has no member write policy on purpose, the
  // runtime is its only writer, and the caller is nobody the console knows.
  const outcome = await deliverWebhookCallback(
    { db: getServiceRoleDb() },
    subscriptionId,
    body
  );

  if (!outcome.ok) {
    // A gate that already expired reads as "gone", not as an error the caller
    // should retry into; a missing row is the same shape as a bad token.
    return outcome.reason === "closed"
      ? Response.json({ status: "closed" }, { status: 410 })
      : Response.json({ error: "invalid_token" }, { status: 401 });
  }
  // A duplicate is a success. A caller told "conflict" retries harder, and the
  // Flow has already continued exactly once, which is the thing that matters.
  return Response.json({ status: outcome.duplicate ? "duplicate" : "received" });
}
