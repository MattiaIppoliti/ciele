import {
  EgressPolicyError,
  validateEgressTarget,
  type ValidatedEgressTarget,
} from "./egress";

/**
 * Crawl-flavored wrapper over the shared egress guard (`egress.ts`) — the
 * range checkers and resolution-time validation live there now; this keeps
 * the crawler's error type stable for its callers and tests.
 */

export class UnsafeCrawlTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeCrawlTargetError";
  }
}

export type ValidatedCrawlTarget = ValidatedEgressTarget;

/** Rejects unsafe targets before any crawler provider receives the URL. */
export async function validateCrawlTarget(
  rawUrl: string
): Promise<ValidatedCrawlTarget> {
  try {
    return await validateEgressTarget(rawUrl);
  } catch (error) {
    if (error instanceof EgressPolicyError) {
      throw new UnsafeCrawlTargetError(error.message);
    }
    throw error;
  }
}
