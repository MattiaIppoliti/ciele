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
