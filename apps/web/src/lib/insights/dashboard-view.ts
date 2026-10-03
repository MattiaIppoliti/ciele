import type { DashboardDay, DashboardLatencyBucket } from "@agent-hub/core";

/**
 * Shapes the Dashboard's computed read into what each chart takes. Pure, so the
 * arithmetic the `.tsx` cards would otherwise hide is tested here.
 */

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
