"use client";

import type {
  DashboardDay,
  DashboardLatencyBucket,
  DashboardStageRow,
  DashboardSurface,
} from "@agent-hub/core";
import { EChartsBarChart } from "@/components/charts/evilcharts/echarts-bar-chart";
import type { ChartConfig } from "@/components/charts/evilcharts/ui/echarts-chart";
import {
  formatCompact,
  formatEur,
  formatEurTick,
  latencyBucketLabel,
  shortDay,
} from "@/lib/insights/dashboard-view";
import { OUTCOME_COLORS, SINGLE_SERIES, SURFACE_COLORS, SURFACE_LABELS } from "./palette";

/**
 * Every bar chart on the Dashboard, in one module so `next/dynamic` loads
 * ECharts once, after first paint, for all of them.
 */

const colors = (pair: { light: string; dark: string }) => ({ light: [pair.light], dark: [pair.dark] });

const SURFACE_KEYS = ["assistants", "teammates", "internal", "unattributed"] as const;

/** Daily estimated spend, stacked by the surface that produced it. */
export function SpendBars({
  daily,
  surface,
}: {
  daily: DashboardDay[];
  surface: DashboardSurface | "";
}) {
  // One surface picked means one series; otherwise the stack, minus any
  // surface that spent nothing (an empty legend entry is noise).
  const keys = surface
    ? [surface]
    : SURFACE_KEYS.filter((key) => daily.some((d) => d.spendBySurface[key] > 0));
  const config = Object.fromEntries(
    keys.map((key) => [key, { label: SURFACE_LABELS[key], colors: colors(SURFACE_COLORS[key]) }])
  ) satisfies ChartConfig;
  const data = daily.map((d) => ({
    day: shortDay(d.day),
    ...Object.fromEntries(keys.map((key) => [key, Number(d.spendBySurface[key].toFixed(4))])),
  }));
  return (
    <EChartsBarChart data={data} config={config} xDataKey="day" stackType="stacked" className="h-72 w-full">
      <EChartsBarChart.Grid />
      <EChartsBarChart.XAxis dataKey="day" />
      <EChartsBarChart.YAxis tickFormatter={(value) => formatEurTick(Number(value))} />
      <EChartsBarChart.Tooltip valueFormatter={(value) => formatEur(value)} />
      {keys.length > 1 && <EChartsBarChart.Legend isClickable />}
      {keys.map((key) => (
        <EChartsBarChart.Bar key={key} dataKey={key} enableHoverHighlight />
      ))}
    </EChartsBarChart>
  );
}

/** Finished turns per day, succeeded under failed. */
export function OutcomeBars({ daily }: { daily: DashboardDay[] }) {
  const config = {
    succeeded: { label: "Succeeded", colors: colors(OUTCOME_COLORS.good) },
    failed: { label: "Failed", colors: colors(OUTCOME_COLORS.bad) },
  } satisfies ChartConfig;
  const data = daily.map((d) => ({
    day: shortDay(d.day),
    succeeded: d.turns - d.failedTurns,
    failed: d.failedTurns,
  }));
  return (
    <EChartsBarChart data={data} config={config} xDataKey="day" stackType="stacked" className="h-56 w-full">
      <EChartsBarChart.Grid />
      <EChartsBarChart.XAxis dataKey="day" />
      <EChartsBarChart.YAxis tickFormatter={(value) => formatCompact(Number(value))} />
      <EChartsBarChart.Tooltip />
      <EChartsBarChart.Legend />
      <EChartsBarChart.Bar dataKey="succeeded" />
      <EChartsBarChart.Bar dataKey="failed" />
    </EChartsBarChart>
  );
}

/** Verifier verdicts per day, passes under failures. */
export function VerdictBars({ daily }: { daily: DashboardDay[] }) {
  const config = {
    passed: { label: "Passed", colors: colors(OUTCOME_COLORS.good) },
    failed: { label: "Failed", colors: colors(OUTCOME_COLORS.bad) },
  } satisfies ChartConfig;
  const data = daily.map((d) => ({ day: shortDay(d.day), passed: d.passes, failed: d.fails }));
  return (
    <EChartsBarChart data={data} config={config} xDataKey="day" stackType="stacked" className="h-56 w-full">
      <EChartsBarChart.Grid />
      <EChartsBarChart.XAxis dataKey="day" />
      <EChartsBarChart.YAxis />
      <EChartsBarChart.Tooltip />
      <EChartsBarChart.Legend />
      <EChartsBarChart.Bar dataKey="passed" />
      <EChartsBarChart.Bar dataKey="failed" />
    </EChartsBarChart>
  );
}

/** How long turns took: the latency histogram, one bar per bucket. */
export function LatencyHistogram({ buckets }: { buckets: DashboardLatencyBucket[] }) {
  const config = { turns: { label: "Turns", colors: colors(SINGLE_SERIES) } } satisfies ChartConfig;
  // Trailing empty buckets carry nothing and squeeze the ones that do.
  const lastUsed = buckets.reduce((last, b, i) => (b.turns > 0 ? i : last), 0);
  const data = buckets
    .slice(0, Math.max(lastUsed + 1, 6))
    .map((b) => ({ bucket: latencyBucketLabel(b), turns: b.turns }));
  return (
    <EChartsBarChart data={data} config={config} xDataKey="bucket" className="h-56 w-full">
      <EChartsBarChart.Grid />
      <EChartsBarChart.XAxis dataKey="bucket" />
      <EChartsBarChart.YAxis tickFormatter={(value) => formatCompact(Number(value))} />
      <EChartsBarChart.Tooltip />
      <EChartsBarChart.Bar dataKey="turns" />
    </EChartsBarChart>
  );
}

const STAGE_LABELS: Record<string, string> = {
  classify: "Classify",
  generate: "Generate",
  embed: "Embed",
  enrich: "Enrich",
  verify: "Verify",
  goal_eval: "Goal evaluation",
  compost: "Compost",
  improvement_proposal: "Improvement proposal",
  graph_search: "Graph search",
  graph_cognify: "Graph cognify",
  rerank: "Rerank",
  memory_extract: "Memory extraction",
  agent_memory: "Agent memory",
  decide: "Decide",
};

/** Spend per pipeline stage, largest first, as horizontal bars. */
export function StageBars({ stages }: { stages: DashboardStageRow[] }) {
  const config = { spend: { label: "Estimated spend", colors: colors(SINGLE_SERIES) } } satisfies ChartConfig;
  // Horizontal bars read top-down; ECharts draws the first category at the bottom.
  const data = [...stages]
    .slice(0, 8)
    .reverse()
    .map((s) => ({ stage: STAGE_LABELS[s.stage] ?? s.stage, spend: Number(s.spendEur.toFixed(4)) }));
  return (
    <EChartsBarChart
      data={data}
      config={config}
      xDataKey="stage"
      layout="horizontal"
      className="h-64 w-full"
    >
      <EChartsBarChart.Grid />
      <EChartsBarChart.YAxis dataKey="stage" />
      <EChartsBarChart.XAxis tickFormatter={(value) => formatEurTick(Number(value))} />
      <EChartsBarChart.Tooltip valueFormatter={(value) => formatEur(value)} />
      <EChartsBarChart.Bar dataKey="spend" />
    </EChartsBarChart>
  );
}

