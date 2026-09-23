/**
 * Where a long Document's Content pane folds (#928).
 *
 * Pure, and in its own module rather than beside the component, because vitest
 * here only picks up `.ts`: a fold that cuts inside a fenced block is exactly
 * the kind of thing a test should hold, not a reviewer.
 */

/**
 * How much body the route paints before the fold. The column allows a million
 * characters, and a crawled page that large would otherwise cost the reader a
 * second of layout before they see the title they clicked.
 */
export const CONTENT_FOLD_CHARS = 4000;

/**
 * Where to cut a folded body: the last line break before the limit, and never
 * inside a fenced code block, whose opening fence would otherwise be rendered
 * without its close and swallow the rest of the excerpt as code.
 *
 * Falls back to the hard limit when the head has no usable break, so a
 * single-line million-character body still folds.
 */
export function foldAt(body: string, limit: number = CONTENT_FOLD_CHARS): number {
  if (body.length <= limit) return body.length;
  const head = body.slice(0, limit);
  const fences = (head.match(/^```/gm) ?? []).length;
  if (fences % 2 === 1) {
    const lastFence = head.lastIndexOf("\n```");
    if (lastFence > 0) return lastFence;
  }
  const lastBreak = head.lastIndexOf("\n");
  return lastBreak > limit / 2 ? lastBreak : limit;
}

/**
 * What the route ships to the client for the Content pane: the head before
 * the fold, or the whole body when it fits. A million-character body is
 * rendered on demand, not serialised into every open of the route; "Show all"
 * fetches the rest through the same operation that read the row.
 */
export function contentHead(body: string): {
  head: string;
  /** The full body's length, so the fold can name what it is hiding. */
  total: number;
  folded: boolean;
} {
  if (body.length <= CONTENT_FOLD_CHARS) {
    return { head: body, total: body.length, folded: false };
  }
  return { head: body.slice(0, foldAt(body)), total: body.length, folded: true };
}
