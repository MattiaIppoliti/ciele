import { clientAddress, createRateLimiter, type RateLimitDecision } from "@/lib/rate-limit";

/**
 * Request budgets for the two widget routes that start a Conversation Turn,
 * `/chat` and `/trigger`, the only public endpoints that can make the platform
 * pay for a model call on every request.
 *
 * This layer is about one caller, not about capacity. It stops a loop, a
 * scripted client or a buggy embed from sending turns faster than a person
 * types; the deployment-wide ceiling is the Postgres-backed concurrency
 * admission inside the runtime (`packages/agent/src/turn-concurrency.ts`),
 * which is shared across instances. The two answer different questions and
 * neither replaces the other.
 *
 * Two keys, both scoped to the assistant:
 *
 * - **Visitor** (or the verified SSO subject): 12 messages a minute. Nobody
 *   reads an answer and writes the next question in five seconds, twelve
 *   times running. The id is client-generated for anonymous traffic, so on its
 *   own it is a budget an attacker renames, which is what the second key is for.
 * - **Address**: 300 a minute. Deliberately loose, because the widget's
 *   audience sits behind shared NATs (an office, a public Wi-Fi, a mobile carrier's
 *   CGNAT) and hundreds of real Visitors can arrive from one address.
 *
 * Proactive triggers get their own, looser visitor budget: a widget reports
 * "chat opened" and "page load" on its own, and a Visitor browsing quickly
 * should not spend their message budget doing it.
 *
 * Same in-process caveat as `rate-limit.ts`: each warm instance counts its
 * own window, so the fleet admits up to `limit × instances`. For a per-caller
 * abuse guard that is an acceptable trade for zero network hops on the hot path.
 */
const WINDOW_MS = 60_000;

const chatPerVisitor = createRateLimiter({ limit: 12, windowMs: WINDOW_MS });
const triggerPerVisitor = createRateLimiter({ limit: 30, windowMs: WINDOW_MS });
const perAddress = createRateLimiter({ limit: 300, windowMs: WINDOW_MS });

export type WidgetTurnKind = "chat" | "trigger";

export function checkWidgetTurnAllowance(input: {
  kind: WidgetTurnKind;
  assistantId: string;
  subjectId: string;
  headers: Headers;
  now?: number;
}): RateLimitDecision {
  const visitorLimiter = input.kind === "chat" ? chatPerVisitor : triggerPerVisitor;
  const visitor = visitorLimiter.check(
    `${input.kind}:${input.assistantId}:${input.subjectId}`,
    input.now
  );
  // Checked second so a Visitor over their own budget does not also spend the
  // address budget their neighbours behind the same NAT share.
  if (!visitor.allowed) return visitor;
  return perAddress.check(
    `${input.assistantId}:${clientAddress(input.headers)}`,
    input.now
  );
}

/**
 * The 429 the widget reads. `retryAfterMs` in the body for the widget (a
 * cross-origin script cannot read `Retry-After` unless it is exposed), and the
 * standard header, in whole seconds, for everything else.
 */
export function widgetThrottledResponse(
  decision: RateLimitDecision,
  cors: HeadersInit
): Response {
  const retryAfterMs = Math.max(1_000, decision.retryAfterMs);
  return Response.json(
    { error: "rate_limited", retryAfterMs },
    {
      status: 429,
      headers: {
        ...Object.fromEntries(new Headers(cors)),
        "Retry-After": String(Math.ceil(retryAfterMs / 1000)),
      },
    }
  );
}

/** Test seam: forget every window. */
export function resetWidgetTurnAllowance(): void {
  chatPerVisitor.reset();
  triggerPerVisitor.reset();
  perAddress.reset();
}
