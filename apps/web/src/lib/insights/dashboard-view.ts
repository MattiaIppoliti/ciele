import type { DashboardDay, DashboardLatencyBucket, DashboardSurfaceRow } from "@agent-hub/core";
import { formatShortDay } from "@/lib/format";

/**
 * Shapes the Dashboard's computed read into what each chart takes. Pure, so the
 * arithmetic the `.tsx` cards would otherwise hide is tested here.
 */

const DAY_MS = 86_400_000;

const EUR_SMALL = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const EUR = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

/**
 * Euros at the precision the amount needs: cents once there are any, four
 * decimals below a cent, because a month of embeddings can cost EUR 0.0037 and
 * "EUR 0.00" would read as free.
 */
export function formatEur(value: number): string {
  if (value === 0) return EUR.format(0);
  return Math.abs(value) < 1 ? EUR_SMALL.format(value) : EUR.format(value);
}

const EUR_TICK = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** An axis tick: "€0", "€0.25", "€1", "€12". Trailing zeros only crowd an axis. */
export function formatEurTick(value: number): string {
  return EUR_TICK.format(value);
}

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** "670.3M", "6.6K", "415". */
export function formatCompact(value: number): string {
  return COMPACT.format(value);
}

/** "850 ms", "2.4 s", "1.1 min"; an em dash for no data. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

/**
 * The label under one latency histogram bar: "<250 ms", "250–500 ms",
 * "500 ms–1 s", "1–1.5 s", "≥60 s". The unit is written once when both ends
 * share it.
 */
export function latencyBucketLabel({ fromMs, toMs }: DashboardLatencyBucket): string {
  const withUnit = (ms: number) => (ms < 1000 ? `${ms} ms` : `${ms / 1000} s`);
  if (toMs === null) return `≥${withUnit(fromMs)}`;
  if (fromMs === 0) return `<${withUnit(toMs)}`;
  if (toMs < 1000) return `${fromMs}–${toMs} ms`;
  if (fromMs >= 1000) return `${fromMs / 1000}–${toMs / 1000} s`;
  return `${withUnit(fromMs)}–${withUnit(toMs)}`;
}

/** The Monday on or before a UTC day, as epoch ms. */
function mondayOf(day: string): number {
  const at = Date.parse(`${day}T00:00:00Z`);
  return at - ((new Date(at).getUTCDay() + 6) % 7) * DAY_MS;
}

interface HeatCalendarData {
  weeks: number;
  /** `values[week][weekday]`, Monday first, intensities 0..1. */
  values: number[][];
  /** The count an intensity of 1 stands for: the busiest day's tokens. */
  maxCount: number;
  /** Last day of the grid, as a UTC Date. */
  endDate: Date;
}

/**
 * Daily token totals as the heat calendar's grid: one Monday-first column per
 * week, ending on the window's last day. A day outside the window reads as
 * zero, which only happens in the leading days of the first week.
 */
export function heatCalendarFromDaily(daily: readonly DashboardDay[]): HeatCalendarData | null {
  if (daily.length === 0) return null;
  const first = daily[0].day;
  const last = daily[daily.length - 1].day;
  const start = mondayOf(first);
  const weeks = Math.floor((mondayOf(last) - start) / (7 * DAY_MS)) + 1;
  const tokens = daily.map((d) => d.inputTokens + d.outputTokens);
  const maxCount = Math.max(0, ...tokens);
  const values = Array.from({ length: weeks }, () => Array.from({ length: 7 }, () => 0));
  daily.forEach((d, i) => {
    const offset = Math.round((Date.parse(`${d.day}T00:00:00Z`) - start) / DAY_MS);
    values[Math.floor(offset / 7)][offset % 7] = maxCount > 0 ? tokens[i] / maxCount : 0;
  });
  return { weeks, values, maxCount, endDate: new Date(`${last}T00:00:00Z`) };
}

/** The busiest day, the average day, and the weekday that carries the most tokens. */
export function tokenHighlights(daily: readonly DashboardDay[]) {
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  let peak: DashboardDay | null = null;
  let total = 0;
  const byWeekday = Array.from({ length: 7 }, () => 0);
  for (const d of daily) {
    const tokens = d.inputTokens + d.outputTokens;
    total += tokens;
    byWeekday[new Date(`${d.day}T00:00:00Z`).getUTCDay()] += tokens;
    if (!peak || tokens > peak.inputTokens + peak.outputTokens) peak = d;
  }
  const busiest = byWeekday.indexOf(Math.max(...byWeekday));
  return {
    peakDay: peak && total > 0 ? peak.day : null,
    peakTokens: peak ? peak.inputTokens + peak.outputTokens : 0,
    averageTokens: daily.length > 0 ? total / daily.length : 0,
    busiestWeekday: total > 0 ? WEEKDAYS[busiest] : null,
  };
}

type SurfaceKey = DashboardSurfaceRow["surface"];

export interface SurfaceComposition {
  /** Period labels, "3 Sept" or "w/c 31 Aug", chronological. */
  periods: string[];
  granularity: "day" | "week";
  /** One entry per surface that spent anything in the window, in fixed order. */
  series: Array<{ surface: SurfaceKey; values: number[] }>;
}

const SURFACE_ORDER: readonly SurfaceKey[] = ["assistants", "teammates", "internal", "unattributed"];

/**
 * Daily spend per surface, summed into the periods the composition chart
 * normalizes. Weekly past three weeks, the same cut as the Flow ranking, so a
 * 90-day window reads as 13 columns rather than 90 slivers. A period that
 * spent nothing sums to zero, which the chart draws as a gap, not as 0% of
 * everything.
 */
export function surfaceCompositionFromDaily(daily: readonly DashboardDay[]): SurfaceComposition {
  const granularity = daily.length > 21 ? "week" : "day";
  const periodOf = (day: string) => (granularity === "day" ? Date.parse(`${day}T00:00:00Z`) : mondayOf(day));
  const starts: number[] = [];
  for (const d of daily) {
    const start = periodOf(d.day);
    if (starts[starts.length - 1] !== start) starts.push(start);
  }
  const index = new Map(starts.map((start, i) => [start, i]));
  const present = SURFACE_ORDER.filter((key) => daily.some((d) => d.spendBySurface[key] > 0));
  const series = present.map((surface) => ({ surface, values: starts.map(() => 0) }));
  for (const d of daily) {
    const i = index.get(periodOf(d.day)) ?? 0;
    for (const row of series) row.values[i] += d.spendBySurface[row.surface];
  }
  const label = (start: number) => {
    const day = new Date(start).toISOString().slice(0, 10);
    return granularity === "week" ? `w/c ${formatShortDay(day)}` : formatShortDay(day);
  };
  return { periods: starts.map(label), granularity, series };
}
