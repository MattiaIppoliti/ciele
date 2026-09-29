"use client";

import type {
  DashboardDay,
  DashboardLatencyBucket,
  DashboardStageRow,
  DashboardSurface,
} from "@agent-hub/core";
import { Bar, BarChart, CartesianGrid, Legend, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  formatCompact,
  formatEur,
  formatEurTick,
  latencyBucketLabel,
} from "@/lib/insights/dashboard-view";
import { formatShortDay } from "@/lib/format";
import { OUTCOME_COLORS, SINGLE_SERIES, SURFACE_COLORS, SURFACE_LABELS } from "./palette";

/**
 * Every bar chart on the Dashboard, in one module so `next/dynamic` loads
 * Recharts once, after first paint, for all of them.
 */

const colors = (pair: { light: string; dark: string }) => ({ light: pair.light, dark: pair.dark });

/**
 * One bar chart for the whole Dashboard: vertical columns by default,
 * `horizontal` for ranked rows. `stacked` puts every series in one stack.
 * Recharts' stock tooltip and legend read the config, so they follow the theme.
 */
function Bars({
  data,
  config,
  category,
  className,
  horizontal = false,
  stacked = false,
  legend = false,
  format,
  tickFormatter,
}: {
  data: Array<Record<string, string | number | null>>;
  config: ChartConfig;
  category: string;
  className: string;
  horizontal?: boolean;
  stacked?: boolean;
  legend?: boolean;
  format?: (value: number) => string;
  tickFormatter?: (value: number) => string;
}) {
  const tick = tickFormatter ? (value: unknown) => tickFormatter(Number(value)) : undefined;
  return (
    <ChartContainer config={config} className={`${className} aspect-auto`}>
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} accessibilityLayer>
        <CartesianGrid horizontal={!horizontal} vertical={horizontal} />
        {horizontal ? (
          <>
            <YAxis dataKey={category} type="category" tickLine={false} axisLine={false} width={120} />
            <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={tick} />
          </>
        ) : (
          <>
            <XAxis dataKey={category} tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} tickFormatter={tick} />
          </>
        )}
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              formatter={
                format
                  ? (value, name) => (
                      <span className="flex w-full justify-between gap-3">
                        <span className="text-muted-foreground">{config[String(name)]?.label ?? name}</span>
                        <span className="font-mono font-medium tabular-nums">{format(Number(value))}</span>
                      </span>
                    )
                  : undefined
              }
            />
          }
        />
        {legend && <Legend formatter={(key: string) => config[key]?.label ?? key} />}
        {Object.keys(config).map((key) => (
          <Bar key={key} dataKey={key} fill={`var(--color-${key})`} stackId={stacked ? "a" : undefined} />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

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
    keys.map((key) => [key, { label: SURFACE_LABELS[key], theme: colors(SURFACE_COLORS[key]) }])
  ) satisfies ChartConfig;
  const data = daily.map((d) => ({
    day: formatShortDay(d.day),
    ...Object.fromEntries(keys.map((key) => [key, Number(d.spendBySurface[key].toFixed(4))])),
  }));
  return (
    <Bars data={data} config={config} category="day" stacked legend={keys.length > 1} className="h-72 w-full" tickFormatter={formatEurTick} format={formatEur} />
  );
}

/** Finished turns per day, succeeded under failed. */
export function OutcomeBars({ daily }: { daily: DashboardDay[] }) {
  const config = {
    succeeded: { label: "Succeeded", theme: colors(OUTCOME_COLORS.good) },
    failed: { label: "Failed", theme: colors(OUTCOME_COLORS.bad) },
  } satisfies ChartConfig;
  const data = daily.map((d) => ({
    day: formatShortDay(d.day),
    succeeded: d.turns - d.failedTurns,
    failed: d.failedTurns,
  }));
  return <Bars data={data} config={config} category="day" stacked legend className="h-56 w-full" tickFormatter={formatCompact} />;
}

/** Verifier verdicts per day, passes under failures. */
export function VerdictBars({ daily }: { daily: DashboardDay[] }) {
  const config = {
    passed: { label: "Passed", theme: colors(OUTCOME_COLORS.good) },
    failed: { label: "Failed", theme: colors(OUTCOME_COLORS.bad) },
  } satisfies ChartConfig;
  const data = daily.map((d) => ({ day: formatShortDay(d.day), passed: d.passes, failed: d.fails }));
  return <Bars data={data} config={config} category="day" stacked legend className="h-56 w-full" />;
}

/** How long turns took: the latency histogram, one bar per bucket. */
export function LatencyHistogram({ buckets }: { buckets: DashboardLatencyBucket[] }) {
  const config = { turns: { label: "Turns", theme: colors(SINGLE_SERIES) } } satisfies ChartConfig;
  // Trailing empty buckets carry nothing and squeeze the ones that do.
  const lastUsed = buckets.reduce((last, b, i) => (b.turns > 0 ? i : last), 0);
  const data = buckets
    .slice(0, Math.max(lastUsed + 1, 6))
    .map((b) => ({ bucket: latencyBucketLabel(b), turns: b.turns }));
  return <Bars data={data} config={config} category="bucket" className="h-56 w-full" tickFormatter={formatCompact} />;
}

const STAGE_LABELS: Record<string, string> = {
  classify: "Classify",
  generate: "Generate",
  embed: "Embed",
  enrich: "Enrich",
  verify: "Verify",
  goal_eval: "Goal evaluation",
  evaluation: "Evaluation experiments",
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
  const config = { spend: { label: "Estimated spend", theme: colors(SINGLE_SERIES) } } satisfies ChartConfig;
  const data = [...stages]
    .slice(0, 8)
    .map((s) => ({ stage: STAGE_LABELS[s.stage] ?? s.stage, spend: Number(s.spendEur.toFixed(4)) }));
  return (
    <Bars data={data} config={config} category="stage" horizontal className="h-64 w-full" tickFormatter={formatEurTick} format={formatEur} />
  );
}
