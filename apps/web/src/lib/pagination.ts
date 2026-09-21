/**
 * Page numbers to render in a pagination control, with "ellipsis" gaps:
 * always the first and last page plus a window around the current one
 * (e.g. 1 2 3 4 5 … 8). Totals of 7 or fewer show every page.
 */
export function paginationRange(
  current: number,
  total: number
): Array<number | "ellipsis"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const window = new Set<number>([1, total, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4, 5].forEach((n) => window.add(n));
  if (current >= total - 2)
    [total - 1, total - 2, total - 3, total - 4].forEach((n) => window.add(n));
  const pages = [...window].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: Array<number | "ellipsis"> = [];
  for (let i = 0; i < pages.length; i++) {
    if (i > 0 && pages[i] - pages[i - 1] > 1) out.push("ellipsis");
    out.push(pages[i]);
  }
  return out;
}

/** The page sizes the table footer offers, smallest first. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export const DEFAULT_PAGE_SIZE = 25;

/**
 * A page size from an untrusted source (a URL the visitor typed) narrowed to
 * one we offer. Anything else falls back to the default rather than letting a
 * `?size=100000` turn one navigation into a full table scan.
 */
export function clampPageSize(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
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
