/**
 * /api/v1 response conventions (#619): one error envelope, one pagination
 * shape. Every route speaks these — clients (the CLI, the MCP server) parse
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

export interface Page<T> {
  data: T[];
  /** Pass back as `?cursor=` for the next page; null on the last page. */
  nextCursor: string | null;
}

/**
 * Cursor pagination over an already-ordered list: the cursor is the id of
 * the last item served. An unknown cursor restarts from the top rather than
 * erroring — cursors are opaque bookmarks, not queries.
 */
export function paginate<T extends { id: string }>(
  items: T[],
  { limit, cursor }: ListParams
): Page<T> {
  let start = 0;
  if (cursor) {
    const at = items.findIndex((item) => item.id === cursor);
    if (at >= 0) start = at + 1;
  }
  const data = items.slice(start, start + limit);
  const nextCursor =
    start + limit < items.length && data.length > 0
      ? data[data.length - 1].id
      : null;
  return { data, nextCursor };
}
