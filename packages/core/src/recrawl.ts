import type { RecrawlSchedule } from "./types";

/**
 * Next scheduled re-crawl time for a website source, derived from its
 * schedule and the last successful crawl. Pure: no clock, no I/O.
 *
 * Returns null when nothing is due on a schedule, the source is set to
 * "never", or it has not completed a crawl yet (so there is no basis to
 * count from). A future per-page override inherits the site schedule, so
 * the same function serves page-level rows once that seam is built.
 */
export function nextCrawlDue(
  schedule: RecrawlSchedule,
  lastCrawledAt: string | null
): string | null {
  if (schedule === "never" || !lastCrawledAt) return null;
  const from = new Date(lastCrawledAt);
  if (Number.isNaN(from.getTime())) return null;
  const next = new Date(from);
  if (schedule === "daily") next.setUTCDate(next.getUTCDate() + 1);
  else if (schedule === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  else if (schedule === "monthly") {
    // Advance one calendar month, clamping the day so end-of-month anchors
    // don't overflow (Jan 31 → Feb 28, not Mar 3).
    const day = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const lastDay = new Date(
      Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)
    ).getUTCDate();
    next.setUTCDate(Math.min(day, lastDay));
  }
  return next.toISOString();
}

/**
 * A crawled page's effective re-crawl cadence: its own override when set,
 * otherwise the site-level schedule it inherits (null = inherit).
 */
export function effectivePageSchedule(
  pageSchedule: RecrawlSchedule | null,
  siteSchedule: RecrawlSchedule
): RecrawlSchedule {
  return pageSchedule ?? siteSchedule;
}
