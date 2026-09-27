// Cached, explicit-locale formatters keep server and browser output identical
// without maintaining a second calendar implementation.
const DAY_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

const TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

const COUNT_FORMATTER = new Intl.NumberFormat("en-US");

const STAT_FORMATTER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/** An ISO string, epoch milliseconds, or a Date. */
type Instant = string | number | Date;

/** "03 Jul 2026". */
export function formatDay(iso: Instant): string {
  return DAY_FORMATTER.format(new Date(iso));
}

/** "03 Jul 26 07:44". */
export function formatDateTime(iso: Instant): string {
  return DATE_TIME_FORMATTER.format(new Date(iso)).replace(",", "");
}

/** "07:44". */
export function formatTime(iso: Instant): string {
  return TIME_FORMATTER.format(new Date(iso));
}

/**
 * "1,234,567". A bare `toLocaleString()` groups by the server's locale while
 * rendering and the reader's while hydrating, and "1.234" is not "1,234".
 */
export function formatCount(value: number): string {
  return COUNT_FORMATTER.format(value);
}

/** "1,234" or "2.5": a KPI or chart value, grouped, at most one decimal. */
export function formatStat(value: number): string {
  return STAT_FORMATTER.format(value);
}

/**
 * "42%" or "12.5%" from a value already on the 0–100 scale, the scale every
 * Insights rate is computed on. One spelling, where the cards used to mix
 * "42 %" and "42%".
 */
export function formatPercent(value: number): string {
  return `${STAT_FORMATTER.format(value)}%`;
}
