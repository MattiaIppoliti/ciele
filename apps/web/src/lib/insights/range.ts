/**
 * Insights date ranges, shared by the server default and the browser's
 * presets. Pure and framework-free, so a client component can import it.
 *
 * Both ends are UTC calendar days. The server used to take its own local day
 * and the browser the reader's, so near midnight the two disagreed about what
 * "today" was and a default load wrote a range into the address bar.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The window a fresh Insights visit opens on, the "Last 30 Days" preset. */
export const DEFAULT_RANGE_DAYS = 30;

/** yyyy-mm-dd of the UTC calendar day `date` falls on. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The last `days` days ending on `now`'s UTC day, both ends inclusive: seven
 * days is today and the six before it, never eight.
 */
export function lastDaysRange(days: number, now = new Date()): { from: string; to: string } {
  return {
    from: utcDay(new Date(now.getTime() - (days - 1) * DAY_MS)),
    to: utcDay(now),
  };
}

/**
 * How many days a range ending today covers, both ends inclusive, or null when
 * it does not end today (it then matches no "Last N Days" preset).
 */
export function trailingRangeDays(from: string, to: string, today: string): number | null {
  if (!from || to !== today) return null;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) return null;
  return Math.round((end - start) / DAY_MS) + 1;
}
