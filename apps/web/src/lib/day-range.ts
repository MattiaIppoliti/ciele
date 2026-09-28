/**
 * A range of whole days as the address bar carries it, `?from=YYYY-MM-DD&to=`,
 * read the one way every date-filtered page reads it.
 *
 * Client-safe and pure. The categorical filters beside a range go through
 * `filtersFromSearchParams` (`url-state.ts`); a range needs more than a list of
 * allowed values, because its two ends are only valid together.
 */

import { readSearchParam, type SearchParamsLike } from "@/lib/url-state";

export interface DayRange {
  /** Inclusive, `YYYY-MM-DD`. */
  from: string;
  /** Inclusive, `YYYY-MM-DD`. */
  to: string;
}

const DAY_MS = 86_400_000;

/**
 * A real calendar day in `YYYY-MM-DD`. `Date.parse` alone is not the test: it
 * rolls 2026-02-31 over into March instead of refusing it.
 */
export function isCalendarDay(value: string | null | undefined): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/**
 * The range a URL asks for. Each end that is missing or not a real day takes
 * the fallback's; an inverted range is swapped rather than rejected; and with
 * `maxDays`, a range longer than that keeps its end and loses its start.
 */
export function dayRangeFromSearchParams(
  params: SearchParamsLike,
  fallback: DayRange,
  options: { maxDays?: number } = {},
): DayRange {
  const rawFrom = readSearchParam(params, "from");
  const rawTo = readSearchParam(params, "to");
  let from = isCalendarDay(rawFrom) ? rawFrom : fallback.from;
  let to = isCalendarDay(rawTo) ? rawTo : fallback.to;
  if (from > to) [from, to] = [to, from];
  if (options.maxDays !== undefined) {
    const earliest = new Date(Date.parse(`${to}T00:00:00Z`) - (options.maxDays - 1) * DAY_MS)
      .toISOString()
      .slice(0, 10);
    if (from < earliest) from = earliest;
  }
  return { from, to };
}
