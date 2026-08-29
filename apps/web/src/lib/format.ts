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

/** "03 Jul 2026". */
export function formatDay(iso: string): string {
  return DAY_FORMATTER.format(new Date(iso));
}

/** "03 Jul 26 07:44". */
export function formatDateTime(iso: string): string {
  return DATE_TIME_FORMATTER.format(new Date(iso)).replace(",", "");
}
