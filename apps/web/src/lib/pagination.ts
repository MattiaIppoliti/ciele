/** The page sizes the table footer offers, smallest first. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export const DEFAULT_PAGE_SIZE = 25;

/**
 * A page size from an untrusted source (a URL the visitor typed) narrowed to
 * one we offer. Anything else falls back to the default rather than letting a
 * `?size=100000` turn one navigation into a full table scan.
 */
export function clampPageSize(value: unknown): (typeof PAGE_SIZE_OPTIONS)[number] {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return PAGE_SIZE_OPTIONS.find(size => size === n) ?? DEFAULT_PAGE_SIZE;
}

export interface PageWindow {
  /** 1-based index of the first row shown; 0 when the table is empty. */
  from: number;
  /** 1-based index of the last row shown; 0 when the table is empty. */
  to: number;
  total: number;
  pageCount: number;
}

/**
 * What the table footer states: which slice of the total is on screen.
 *
 * The last page is usually short, so `to` is the total rather than
 * `page * pageSize`, and an empty table reports 0–0 instead of 1–0.
 */
export function pageWindow(
  page: number,
  pageSize: number,
  total: number
): PageWindow {
  const size = Math.max(1, pageSize);
  const pageCount = Math.max(1, Math.ceil(total / size));
  if (total <= 0) return { from: 0, to: 0, total: 0, pageCount: 1 };
  const current = Math.min(Math.max(1, page), pageCount);
  const from = (current - 1) * size + 1;
  return { from, to: Math.min(current * size, total), total, pageCount };
}

/** "1 campaign" / "2 campaigns", the only plural rule the footer needs. */
export function countLabel(total: number, noun: string, plural?: string): string {
  return `${total} ${total === 1 ? noun : (plural ?? `${noun}s`)}`;
}

/** Keep the current page and the ends reachable without growing the footer. */
export function pageNumbers(current: number, totalPages: number): Array<number | "before" | "after"> {
  const last = Math.max(1, totalPages);
  const page = Math.min(last, Math.max(1, current));
  if (last <= 7) return Array.from({ length: last }, (_, index) => index + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, "after", last];
  if (page >= last - 3) return [1, "before", last - 4, last - 3, last - 2, last - 1, last];
  return [1, "before", page - 1, page, page + 1, "after", last];
}
