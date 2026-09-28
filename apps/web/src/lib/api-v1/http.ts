/**
 * /api/v1 response conventions (#619): one error envelope, one pagination
 * shape. Every route speaks these, clients (the CLI, the MCP server) parse
 * one format, not one per endpoint.
 */

/** The uniform error envelope: `{ error: { code, message } }`. */
export function apiError(
  status: number,
  code: string,
  message: string
): Response {
  return Response.json({ error: { code, message } }, { status });
}

/** The 429 envelope, with `retry-after` in whole seconds (never 0). */
export function apiRateLimited(message: string, retryAfterMs: number): Response {
  const response = apiError(429, "rate_limited", message);
  response.headers.set("retry-after", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  return response;
}

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

export interface ListParams {
  limit: number;
  cursor: string | null;
}

/** `?limit=` (clamped to [1, 100], default 50) and `?cursor=` (opaque). */
export function parseListParams(url: URL): ListParams {
  const rawLimit = Number(url.searchParams.get("limit") ?? DEFAULT_PAGE_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_PAGE_LIMIT)
    : DEFAULT_PAGE_LIMIT;
  return { limit, cursor: url.searchParams.get("cursor") };
}
