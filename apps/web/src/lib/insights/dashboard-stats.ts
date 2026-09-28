import type { DashboardDay, UsageDashboard } from "@agent-hub/core";
import { shortDay } from "./dashboard-view";

/**
 * The stat cards on the Costs and Observability dashboards, as data. Pure and
 * JSON-safe (the card component maps `kind` to a formatter), so which series,
 * which comparison and which direction counts as good are tested here rather
 * than buried in a `.tsx`.
 */

export type StatKind = "eur" | "count" | "decimal" | "compact" | "percent" | "ms";

export interface StatSpec {
  key: string;
  label: string;
  kind: StatKind;
  value: number;
  /** The previous period's value; null when there is nothing to compare against. */
  previous: number | null;
  /** One point per day for the sparkline; gaps carried forward (see `carryForward`). */
  series: number[];
  labels: string[];
  goodWhen: "up" | "down" | "neutral";
  /** Shown instead of a delta when `previous` is null. */
  caption: string;
}

type Totals = UsageDashboard["totals"];

/**
 * A rate or latency has no value on a day with no turns. The sparkline needs a
 * number there, and carrying the last known value draws a flat segment, which
 * reads as "nothing changed" rather than inventing a drop to zero.
 */
export function carryForward(values: readonly (number | null)[]): number[] {
  const first = values.find((v): v is number => v !== null) ?? 0;
  let last = first;
  return values.map((v) => {
    if (v !== null) last = v;
    return last;
  });
}

function ratioSeries(daily: readonly DashboardDay[], part: (d: DashboardDay) => number, whole: (d: DashboardDay) => number) {
  return carryForward(daily.map((d) => (whole(d) > 0 ? (part(d) / whole(d)) * 100 : null)));
}

/** A comparison only exists when the earlier period measured the same thing. */
function prior(previous: Totals | null, pick: (t: Totals) => number | null): number | null {
  if (!previous) return null;
  const value = pick(previous);
  return value === null || value === 0 ? null : value;
}

const NO_EARLIER = "No earlier data to compare";

export function costStats(dashboard: UsageDashboard, previous: Totals | null): StatSpec[] {
  const { daily, totals } = dashboard;
  const labels = daily.map((d) => shortDay(d.day));
  return [
    {
      key: "spend",
      label: "Estimated spend",
      kind: "eur",
      value: totals.spendEur,
      previous: prior(previous, (t) => t.spendEur),
      series: daily.map((d) => d.spendEur),
      labels,
      goodWhen: "down",
      caption: NO_EARLIER,
    },
    {
      key: "costPerTurn",
      label: "Cost per turn",
      kind: "eur",
      value: totals.costPerTurnEur ?? 0,
      previous: prior(previous, (t) => t.costPerTurnEur),
      series: carryForward(daily.map((d) => (d.turns > 0 ? d.spendEur / d.turns : null))),
      labels,
      goodWhen: "down",
      caption: totals.costPerTurnEur === null ? "No finished turns" : NO_EARLIER,
    },
    {
      key: "calls",
      label: "Model calls",
      kind: "count",
      value: totals.calls,
      previous: prior(previous, (t) => t.calls),
      series: daily.map((d) => d.calls),
      labels,
      goodWhen: "neutral",
      caption: NO_EARLIER,
    },
    {
      key: "tokens",
      label: "Total tokens",
      kind: "compact",
      value: totals.inputTokens + totals.outputTokens,
      previous: prior(previous, (t) => t.inputTokens + t.outputTokens),
      series: daily.map((d) => d.inputTokens + d.outputTokens),
      labels,
      goodWhen: "neutral",
      caption: NO_EARLIER,
    },
  ];
}

/**
 * Accuracy and autonomy are Assistant measures: when the filter leaves them
 * with nothing to measure, their cards are left out rather than shown at 0%.
 */
export function observabilityStats(dashboard: UsageDashboard, previous: Totals | null): StatSpec[] {
  const { daily, totals } = dashboard;
  const labels = daily.map((d) => shortDay(d.day));
  const percent = (rate: number | null) => (rate === null ? null : rate * 100);
  const cards: Array<StatSpec | null> = [
    {
      key: "turns",
      label: "Finished turns",
      kind: "count",
      value: totals.turns,
      previous: prior(previous, (t) => t.turns),
      series: daily.map((d) => d.turns),
      labels,
      goodWhen: "neutral",
      caption: NO_EARLIER,
    },
    totals.successRate === null
      ? null
      : {
          key: "success",
          label: "Success rate",
          kind: "percent",
          value: totals.successRate * 100,
          previous: prior(previous, (t) => percent(t.successRate)),
          series: ratioSeries(daily, (d) => d.turns - d.failedTurns, (d) => d.turns),
          labels,
          goodWhen: "up",
          caption: NO_EARLIER,
        },
    {
      key: "p50",
      label: "Median latency",
      kind: "ms",
      value: totals.latencyP50Ms ?? 0,
      previous: prior(previous, (t) => t.latencyP50Ms),
      series: carryForward(daily.map((d) => d.latencyP50Ms)),
      labels,
      goodWhen: "down",
      caption: totals.latencyP50Ms === null ? "No finished turns" : NO_EARLIER,
    },
    {
      key: "p95",
      label: "p95 latency",
      kind: "ms",
      value: totals.latencyP95Ms ?? 0,
      previous: prior(previous, (t) => t.latencyP95Ms),
      series: carryForward(daily.map((d) => d.latencyP95Ms)),
      labels,
      goodWhen: "down",
      caption: totals.latencyP95Ms === null ? "No finished turns" : NO_EARLIER,
    },
    totals.evalPassRate === null
      ? null
      : {
          key: "accuracy",
          label: "Answer accuracy",
          kind: "percent",
          value: totals.evalPassRate * 100,
          previous: prior(previous, (t) => percent(t.evalPassRate)),
          series: ratioSeries(daily, (d) => d.passes, (d) => d.passes + d.fails),
          labels,
          goodWhen: "up",
          caption: NO_EARLIER,
        },
    totals.autonomyRate === null
      ? null
      : {
          key: "autonomy",
          label: "Autonomy",
          kind: "percent",
          value: totals.autonomyRate * 100,
          previous: prior(previous, (t) => percent(t.autonomyRate)),
          series: ratioSeries(daily, (d) => d.conversations - d.escalated, (d) => d.conversations),
          labels,
          goodWhen: "up",
          caption: NO_EARLIER,
        },
    {
      key: "failed",
      label: "Failed turns",
      kind: "count",
      value: totals.failedTurns,
      previous: prior(previous, (t) => t.failedTurns),
      series: daily.map((d) => d.failedTurns),
      labels,
      goodWhen: "down",
      caption: NO_EARLIER,
    },
    {
      key: "toolCalls",
      label: "Tool calls per turn",
      kind: "decimal",
      value: totals.toolCallsPerTurn ?? 0,
      previous: prior(previous, (t) => t.toolCallsPerTurn),
      series: [],
      labels,
      goodWhen: "neutral",
      caption: totals.toolCallsPerTurn === null ? "No finished turns" : NO_EARLIER,
    },
  ];
  return cards.filter((card): card is StatSpec => card !== null);
}

/**
 * The Assistant Overview's Activity rows: turns, failure rate and p95
 * latency over the last seven days. The same `StatSpec`s the dashboards
 * render, so the Overview scrubs and compares exactly as they do.
 */
export function activityStats(dashboard: UsageDashboard, previous: Totals | null): StatSpec[] {
  const { daily, totals } = dashboard;
  const labels = daily.map((d) => shortDay(d.day));
  const failure = (t: Totals) => (t.turns > 0 ? (t.failedTurns / t.turns) * 100 : null);
  return [
    {
      key: "turns",
      label: "Turns",
      kind: "count",
      value: totals.turns,
      previous: prior(previous, (t) => t.turns),
      series: daily.map((d) => d.turns),
      labels,
      goodWhen: "neutral",
      caption: NO_EARLIER,
    },
    {
      key: "failure",
      label: "Failure rate",
      kind: "percent",
      value: failure(totals) ?? 0,
      previous: prior(previous, failure),
      series: carryForward(daily.map((d) => (d.turns > 0 ? (d.failedTurns / d.turns) * 100 : null))),
      labels,
      goodWhen: "down",
      caption: NO_EARLIER,
    },
    {
      key: "p95",
      label: "p95 latency",
      kind: "ms",
      value: totals.latencyP95Ms ?? 0,
      previous: prior(previous, (t) => t.latencyP95Ms),
      series: carryForward(daily.map((d) => d.latencyP95Ms)),
      labels,
      goodWhen: "down",
      caption: NO_EARLIER,
    },
  ];
}
