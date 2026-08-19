import { NextRequest } from "next/server";
import {
  CONSENT_LOG_LIMITS,
  parseConsentRecord,
  recordConsent,
} from "@/lib/consent-log";

// Writes a per-visitor audit row; never cached, never prerendered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Records one cookie-consent decision (GDPR Art. 7(1) accountability).
 *
 * Public and unauthenticated by necessity, the visitors whose consent we must
 * be able to evidence are anonymous. That makes this a trust boundary:
 *
 * - Every response is 204, whatever happens. A visitor gets no feedback about
 *   our audit log, and a probe cannot tell a rejected payload from a stored one.
 * - The body is size-capped before parsing and schema-validated after.
 * - Cross-origin posts are refused: only our own pages have any business
 *   writing here, and the check turns drive-by junk into a cheap 204.
 * - A storage failure is swallowed after logging. Failing the request would do
 *   nothing for the visitor, their choice is already applied client-side and
 *   held in their own cookie, and surfacing it would only invite probing.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noContent();

  const raw = await readCappedBody(request);
  if (raw === null) return noContent();

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return noContent();
  }

  const record = parseConsentRecord(body, {
    // Taken from the request, not the payload, one of the two facts here we
    // do not have to treat as hostile.
    userAgent: request.headers.get("user-agent"),
  });
  if (!record) return noContent();

  try {
    await recordConsent(record);
  } catch (error) {
    // Losing a record is a compliance gap, so it must be visible in logs even
    // though the response stays silent.
    console.error("Failed to record cookie consent", error);
  }

  return noContent();
}

function noContent(): Response {
  return new Response(null, { status: 204, headers: NO_STORE });
}

/**
 * Rejects posts from other origins. `sendBeacon` and `fetch` both send an
 * `Origin` header on cross-origin requests; a same-origin `fetch` may omit it,
 * so a missing Origin is allowed and only a *mismatching* one is refused.
 */
function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.nextUrl.host;
  } catch {
    return false;
  }
}

/**
 * Reads the body only if it is plausibly one consent record. Checks the
 * declared length first, then counts what actually arrives, so a lying or
 * absent Content-Length cannot stream something large into memory.
 */
async function readCappedBody(request: NextRequest): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > CONSENT_LOG_LIMITS.bodyBytes) {
    return null;
  }
  const raw = await request.text();
  if (raw.length > CONSENT_LOG_LIMITS.bodyBytes) return null;
  return raw;
}
