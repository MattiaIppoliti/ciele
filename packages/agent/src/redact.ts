/**
 * Scrubs bearer credentials out of any text destined for an error, an Alert, a
 * client response, or telemetry. Shared by the private-worker adapters
 * (crawler, graph) so the redaction rules live in exactly one place.
 *
 * A worker token only ever travels in the `Authorization` header, but a
 * misconfigured or verbose worker could echo it (or the raw header) back in an
 * error body — so before any worker text leaves an adapter it is stripped of:
 *   1. the configured token itself (verbatim), when provided;
 *   2. any `Bearer <value>` sequence, however cased;
 *   3. any `authorization: <value>` / `"authorization": "<value>"` header echo,
 *      including one that has been JSON-escaped by being nested inside a string
 *      (`{\"authorization\":\"…\"}`) — which is how an API response body reaches
 *      a stored turn trace (#557/#559), where the quotes are escaped and a
 *      quote-anchored pattern would sail straight past the secret.
 */
export function redactBearerSecrets(text: string, token?: string): string {
  let out = text;
  if (token) out = out.split(token).join("[redacted]");
  out = out.replace(/Bearer\s+[\w.\-~+/=]+/gi, "Bearer [redacted]");
  out = out.replace(
    /(\\?"?authorization\\?"?\s*[:=]\s*\\?"?)[^"\\\s,}]+/gi,
    "$1[redacted]"
  );
  return out;
}

/** Strips trailing slashes from a base URL so paths join cleanly. */
export function trimTrailingSlash(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}
