/**
 * The one thing a job handler needs to say that the ledger reads back.
 *
 * Its own module, not a corner of `jobs.ts`, because the handlers live in the
 * files that own their domain (`review-runtime.ts`, `webhook-runtime.ts`) and
 * `jobs.ts` imports *them* to build its registry. A handler importing a value
 * back out of `jobs.ts` closes that loop, and a cycle through a module-level
 * `const` is a `ReferenceError` at import time under a bundler that hoists
 * differently from vitest, which is exactly how this shipped broken once.
 */

/** An error the job runner must not retry: the input is wrong, not the moment. */
export function nonRetryable(message: string): Error {
  return Object.assign(new Error(message), { retryable: false });
}
