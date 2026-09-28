import type { DashboardSurface, UsageDashboard, UsageDashboardFilter } from "@agent-hub/core";
import { dayRangeFromSearchParams } from "@/lib/day-range";

/**
 * The Dashboard tab's filter, parsed from and written back to the address bar.
 * Client-safe (no server imports), so the page and its client component read
 * one definition of the defaults.
 */

export interface DashboardView {
  dashboard: UsageDashboard;
  /**
   * The same measures over the period of equal length just before this one,
   * for the stat cards' deltas; null when that period carried no activity at
   * all, so a card says "no earlier data" rather than "+100%".
   */
  previous: UsageDashboard["totals"] | null;
  /** True while the deployed code is ahead of its migration; see `dashboard.ts`. */
  unavailable: boolean;
}

export const DASHBOARD_SURFACES: readonly DashboardSurface[] = ["assistants", "teammates", "internal"];

/** The longest window one read covers; a year of daily facts is still small. */
export const MAX_DASHBOARD_DAYS = 366;

const DAY_MS = 86_400_000;

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The last 30 UTC days, today included. */
export function defaultDashboardFilter(now = new Date()): UsageDashboardFilter {
  const today = Date.parse(`${utcDay(now.getTime())}T00:00:00Z`);
  return { from: utcDay(today - 29 * DAY_MS), to: utcDay(today), surface: "", assistantId: "" };
}

/**
 * Anything invalid falls back to the defaults; an inverted range is swapped
 * rather than rejected; a range past a year keeps its end and loses its start.
 * An Assistant is only honoured beside the surface it belongs to.
 */
export function dashboardFilterFromSearchParams(
  params: URLSearchParams,
  now = new Date()
): UsageDashboardFilter {
  const { from, to } = dayRangeFromSearchParams(params, defaultDashboardFilter(now), {
    maxDays: MAX_DASHBOARD_DAYS,
  });
  const surfaceParam = params.get("surface");
  const surface = DASHBOARD_SURFACES.find((s) => s === surfaceParam) ?? "";
  const assistantId = surface === "" || surface === "assistants" ? params.get("assistantId") || "" : "";
  return { from, to, surface, assistantId };
}

/** The `[from, to)` instants a filter's inclusive UTC days cover. */
export function dashboardWindow(filter: UsageDashboardFilter): { from: string; to: string } {
  return {
    from: `${filter.from}T00:00:00.000Z`,
    to: `${utcDay(Date.parse(`${filter.to}T00:00:00Z`) + DAY_MS)}T00:00:00.000Z`,
  };
}

/** The period of the same length that ends the day before `filter` starts. */
export function previousPeriodFilter(filter: UsageDashboardFilter): UsageDashboardFilter {
  const from = Date.parse(`${filter.from}T00:00:00Z`);
  const to = Date.parse(`${filter.to}T00:00:00Z`);
  const length = Math.round((to - from) / DAY_MS) + 1;
  return {
    ...filter,
    from: utcDay(from - length * DAY_MS),
    to: utcDay(from - DAY_MS),
  };
}
