import { createRateLimiter, type RateLimitDecision } from "@/lib/rate-limit";

/**
 * The per-member upload budget (#801, CYB-01, the half the authorization
 * reorder left open). Moving `requireMember` ahead of the parser stopped an
 * *unauthenticated* request from spending parser CPU; it said nothing about an
 * authorized member scripting the Server Action, and a 25 MiB PDF is exactly
 * the kind of work a loop turns into a denial of service from inside the
 * tenant.
 *
 * Twenty uploads per member per ten minutes: far above what the Knowledge UI
 * can produce by hand (each upload is a file-picker round trip), far below
 * what a parser-exhaustion loop needs. Keyed on organization + member so one
 * noisy member cannot starve their colleagues, and checked *after*
 * authorization on purpose: the anonymous case is already refused outright,
 * and a pre-auth check keyed on anything client-supplied would be a budget an
 * attacker chooses the key for.
 *
 * Same in-process, per-instance caveat as `rate-limit.ts` documents: on
 * serverless this bounds each warm instance, not the fleet. That still turns
 * a trivial loop into work, which is the finding's ask.
 */
const uploadLimiter = createRateLimiter({ limit: 20, windowMs: 10 * 60 * 1000 });

export function checkUploadAllowance(
  organizationId: string,
  userId: string,
  now?: number
): RateLimitDecision {
  return uploadLimiter.check(`${organizationId}:${userId}`, now);
}

/** The refusal the Knowledge upload forms show; seconds so it reads as advice. */
export function uploadThrottledMessage(retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `Too many uploads at once. Try again in ${seconds}s.`;
}

/** Test seam: forget every window. */
export function resetUploadAllowance(): void {
  uploadLimiter.reset();
}
