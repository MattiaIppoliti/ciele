/**
 * One retry for the transient 401 Supabase occasionally answers a perfectly
 * valid session with.
 *
 * Four of them in 24h of production logs, and they were the only failing
 * requests in the whole day. Each landed within seconds of a
 * `POST /auth/v1/token` refresh, and none of them was an auth problem: the
 * 401'd read carried the same access token (same signature prefix, same
 * expiry) as two sibling reads that got 200 seven milliseconds earlier, and
 * that same token got 200 on the same query two minutes later.
 *
 * It blanked the entire console because the admin layout resolves the session
 * before it renders anything: `requirePageMember` -> `getSession` ->
 * `db.getCurrentOrg`, which rethrows the PostgREST error. One unlucky read out
 * of the eight a page render makes therefore replaced the whole document with
 * Next's built-in error page, and a reload always fixed it.
 *
 * Scoped as tightly as the evidence supports: reads only, PostgREST only, one
 * extra attempt. A session that is genuinely gone still 401s on the retry and
 * still reaches the caller.
 */

/** Bodyless and safe to replay. Anything else is left alone. */
const REPLAYABLE_METHODS = new Set(["GET", "HEAD"]);

/**
 * Long enough to clear the blip, short enough that a real 401 costs the
 * signed-out visitor nothing they would notice on the way to /login.
 */
const DEFAULT_RETRY_DELAY_MS = 120;

const methodOf = (input: RequestInfo | URL, init?: RequestInit): string =>
  (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;

/**
 * A table read. `/rpc/` is excluded on purpose: a function call is a POST and
 * may well write, so it never qualifies on the method rule either, but saying
 * so here keeps the intent readable if that ever changes.
 */
const isTableRead = (url: string) =>
  url.includes("/rest/v1/") && !url.includes("/rest/v1/rpc/");

export function withTransientRetry(
  inner: typeof fetch,
  retryDelayMs: number = DEFAULT_RETRY_DELAY_MS
): typeof fetch {
  return async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const response = await inner(input, init);

    if (
      response.status !== 401 ||
      !REPLAYABLE_METHODS.has(methodOf(input, init)) ||
      !isTableRead(urlOf(input))
    ) {
      return response;
    }

    // Nobody will read the discarded body, so release the socket rather than
    // leaving the stream dangling.
    await response.body?.cancel().catch(() => {});

    if (retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }

    return inner(input, init);
  };
}
