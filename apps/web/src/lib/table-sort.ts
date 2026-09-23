/**
 * Ordering for the console's tables that hold all their rows.
 *
 * The paged tables (the Library, a Source's Documents) sort in SQL, because
 * ordering the fifty rows a page already chose is not ordering. These are the
 * other kind: an Assistant's Knowledge lists and a Document's Memories render
 * everything they have, so the comparison can live here.
 */

export interface ClientSort {
  key: string;
  ascending: boolean;
}

/** What a column can be ordered on. `null` sorts last in either direction. */
export type SortValue = string | number | null;

function compare(a: SortValue, b: SortValue): number {
  if (a === null && b === null) return 0;
  // Null last whichever way the column points: an empty cell is absent, not
  // first or smallest, and a reader flipping the sort is looking for the
  // other end of the data rather than for the gaps.
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).toLowerCase().localeCompare(String(b).toLowerCase());
}

/**
 * Orders a copy of `rows`. An unsorted table, or a column with no accessor,
 * keeps the order it arrived in, which is the one the server chose.
 */
export function sortRows<T>(
  rows: readonly T[],
  sort: ClientSort | null,
  accessors: Record<string, (row: T) => SortValue>
): T[] {
  const read = sort ? accessors[sort.key] : undefined;
  if (!sort || !read) return [...rows];
  const factor = sort.ascending ? 1 : -1;
  return [...rows].sort((a, b) => {
    const value = compare(read(a), read(b));
    // Nulls ignore the direction, so they do not migrate to the top on a
    // flip; everything else follows it.
    if (read(a) === null || read(b) === null) return value;
    return factor * value;
  });
}


/**
 * The slice of `rows` one page shows, with the page clamped into range.
 *
 * A filter that shrinks the set below the current page must not leave the
 * reader on an empty page they did not navigate to, so the clamp is here
 * rather than in an effect that corrects the state afterwards.
 */
export function pageSlice<T>(
  rows: readonly T[],
  page: number,
  pageSize: number
): { items: T[]; page: number } {
  const pageCount = Math.max(1, Math.ceil(rows.length / Math.max(1, pageSize)));
  const current = Math.min(Math.max(1, page), pageCount);
  const from = (current - 1) * pageSize;
  return { items: rows.slice(from, from + pageSize), page: current };
}
