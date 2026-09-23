/**
 * Pure derivations for the Chunks tab (#929): the card label, the dialog's
 * word count, and which page a chunk index lives on. In `lib/` because vitest
 * here only picks up `.ts`, and the paging arithmetic is the part of that tab
 * most likely to be off by one.
 */

/** `01`, `02`, … `12`. One-based for a reader; the stored index is zero-based. */
export function chunkLabel(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/**
 * Words in a chunk, the figure the dialog footer prints.
 *
 * Whitespace-separated runs, which is what a person counting would say. It is
 * not the model's token count and does not pretend to be.
 */
export function chunkWordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/** Which 1-based page holds a 0-based chunk index. */
export function pageForChunkIndex(index: number, pageSize: number): number {
  return Math.floor(Math.max(0, index) / Math.max(1, pageSize)) + 1;
}

/**
 * Filters loaded chunks by substring, case-insensitively.
 *
 * Deliberately over the *loaded* page only, which the tab says: a search that
 * silently covered some of a 400-chunk Document and not the rest would be
 * worse than one whose scope is stated.
 */
export function filterChunks<T extends { text: string }>(
  chunks: T[],
  query: string
): T[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return chunks;
  return chunks.filter((chunk) => chunk.text.toLowerCase().includes(needle));
}

/** A card's preview: the first few lines, cut on a word boundary. */
export function chunkPreview(text: string, limit = 180): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > limit / 2 ? lastSpace : limit)}…`;
}
