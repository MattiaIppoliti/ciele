"use client";

import { EmptyState } from "@/components/ui/empty-state";

import type { DashboardDay, UsageDashboard } from "@agent-hub/core";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { BumpChart, type BumpChartSeries } from "@/components/charts/beui/bump-chart";
import { ArcFrame } from "@/components/charts/arc/arc-frame";
import { ActivityHeatmap } from "@/components/charts/arc/activity-heatmap/activity-heatmap";
import { Streamgraph } from "@/components/charts/arc/streamgraph/streamgraph";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatDuration, formatEur } from "@/lib/insights/dashboard-view";
import { formatShortDay } from "@/lib/format";
import { CHART_SERIES } from "@/components/charts/palette";
import { RANK_COLORS, SURFACE_COLORS, SURFACE_LABELS } from "./palette";

export function TokenHeatCalendar({ daily }: { daily: DashboardDay[] }) {
  if (!daily.some((d) => d.inputTokens + d.outputTokens > 0)) return <EmptyState size="sm" title="No tokens in this range" description="Choose a wider date range or wait for new AI turns." />;
  return <ArcFrame><ActivityHeatmap days={daily.map((d) => ({ date: d.day, count: d.inputTokens + d.outputTokens }))}
    label="Daily token usage" period={`${daily[0]?.day} – ${daily[daily.length - 1]?.day} (UTC)`}
    unit={{ one: "token", other: "tokens" }} weekStartsOn={1} locale="en-GB" /></ArcFrame>;
}

const SURFACES = ["assistants", "teammates", "internal", "unattributed"] as const;
export function SurfaceComposition({ daily }: { daily: DashboardDay[] }) {
  const keys = SURFACES.filter((key) => daily.some((d) => d.spendBySurface[key] > 0));
  if (keys.length === 0) return <EmptyState size="sm" title="No spend in this range" description="Choose a wider date range to see recorded usage." />;
  return <ArcFrame><Streamgraph label="Estimated spend by surface over time" height={260}
    series={keys.map((key) => ({ key, label: SURFACE_LABELS[key], color: SURFACE_COLORS[key] }))}
    data={daily.map((d) => ({ key: d.day, label: d.day, axisLabel: formatShortDay(d.day), values: d.spendBySurface }))}
    formatValue={formatEur} categoryLabel="UTC day" emptyLabel="No spend in this range." /></ArcFrame>;
}

/** Retained: Arc has no rank-over-many-periods chart; a slope chart would lose intermediate ranks. */
export function FlowBumpChart({ flows }: { flows: UsageDashboard["flows"] }) {
  if (flows.series.length === 0) return <EmptyState size="sm" title="No routed turns in this range" description="Flow rankings appear once turns name the Flow that handled them. Try a wider date range." />;
  const series: BumpChartSeries[] = flows.series.map((flow, i) => ({ id: flow.name, name: flow.name, ranks: flow.ranks, color: RANK_COLORS[i] }));
  const periods = flows.periods.map((p) => flows.granularity === "week" ? `w/c ${formatShortDay(p)}` : formatShortDay(p));
  return <BumpChart series={series} periods={periods} label="Most used Flows" className="mx-auto max-w-3xl" />;
}

/** Retained: Arc line-chart converts absent values to zero; measured latency needs visible gaps. */
const LATENCY_CONFIG = {
  p50: { label: "p50", color: CHART_SERIES[0] },
  p95: { label: "p95", color: CHART_SERIES[3] },
} satisfies ChartConfig;

/** Median and 95th-percentile turn latency per day, on one axis. */
export function LatencyTrend({ daily }: { daily: DashboardDay[] }) {
  const data = daily.map((d) => ({
    day: formatShortDay(d.day),
    p50: d.latencyP50Ms,
    p95: d.latencyP95Ms,
  }));
  return (
    <ChartContainer config={LATENCY_CONFIG} className="h-56 w-full">
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={24} fontSize={10} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={48}
          fontSize={10}
          tickFormatter={(value: number) => formatDuration(value)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent formatter={(value, name) => `${name}: ${formatDuration(Number(value))}`} />
          }
        />
        <Area
          dataKey="p95"
          strokeDasharray="5 4"
          type="monotone"
          stroke="var(--color-p95)"
          fill="var(--color-p95)"
          fillOpacity={0.08}
          strokeWidth={2}
        />
        <Area
          dataKey="p50"
          type="monotone"
          stroke="var(--color-p50)"
          fill="var(--color-p50)"
          fillOpacity={0.12}
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  );
}
