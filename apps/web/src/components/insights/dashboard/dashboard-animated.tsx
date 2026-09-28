"use client";

import type { DashboardDay, UsageDashboard } from "@agent-hub/core";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { BumpChart, type BumpChartSeries } from "@/components/charts/beui/bump-chart";
import { CompositionChart } from "@/components/charts/beui/composition-chart";
import {
  HeatCalendar,
  HeatCalendarGrid,
  HeatCalendarLegend,
  HeatCalendarTooltip,
} from "@/components/charts/beui/heat-calendar";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  formatCompact,
  formatDuration,
  formatEur,
  heatCalendarFromDaily,
  shortDay,
  surfaceCompositionFromDaily,
} from "@/lib/insights/dashboard-view";
import { RANK_COLORS, SINGLE_SERIES, SURFACE_COLORS, SURFACE_LABELS } from "./palette";

/**
 * The Dashboard's motion-driven charts (the beui heat calendar and bump chart)
 * and its one line chart, loaded after first paint like the bar charts.
 */

const RANGE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Tokens per day as a single-hue calendar: magnitude reads as strength of one colour. */
export function TokenHeatCalendar({ daily }: { daily: DashboardDay[] }) {
  const grid = heatCalendarFromDaily(daily);
  if (!grid || grid.maxCount === 0) {
    return <p className="text-muted-foreground py-10 text-center text-sm">No tokens in this range.</p>;
  }
  return (
    <HeatCalendar
      unit="tokens"
      weeks={grid.weeks}
      values={grid.values}
      maxCount={grid.maxCount}
      endDate={grid.endDate}
      color={SINGLE_SERIES.light}
      className="w-full"
    >
      <HeatCalendarGrid>
        <HeatCalendarTooltip>
          {(tip) => (
            <>
              <span className="font-mono tabular-nums">
                {formatCompact(tip.days > 1 ? tip.total : tip.count)} tokens
              </span>
              <span className="text-muted-foreground">
                {tip.days > 1
                  ? `${RANGE.format(tip.startDate)} – ${RANGE.format(tip.endDate)} · ${tip.days} days`
                  : RANGE.format(tip.date)}
              </span>
            </>
          )}
        </HeatCalendarTooltip>
      </HeatCalendarGrid>
      <HeatCalendarLegend />
    </HeatCalendar>
  );
}

/**
 * Each surface's share of spend per day (per week past three weeks). Hovering
 * a column reads that period out in the legend; a period that spent nothing
 * is a gap rather than a column of zeros.
 */
export function SurfaceComposition({ daily }: { daily: DashboardDay[] }) {
  const composition = surfaceCompositionFromDaily(daily);
  if (composition.series.length === 0) {
    return <p className="text-muted-foreground py-10 text-center text-sm">No spend in this range.</p>;
  }
  return (
    <CompositionChart
      label="Share of estimated spend by surface"
      periods={composition.periods}
      series={composition.series.map((row) => ({
        id: row.surface,
        name: SURFACE_LABELS[row.surface],
        color: SURFACE_COLORS[row.surface].light,
        values: row.values,
      }))}
      formatValue={formatEur}
    />
  );
}

/** The five most used Flows, ranked against each other per period. */
export function FlowBumpChart({ flows }: { flows: UsageDashboard["flows"] }) {
  if (flows.series.length === 0) {
    return (
      <p className="text-muted-foreground py-16 text-center text-sm">
        No routed turns in this range. Flow rankings appear once turns name the Flow that handled them.
      </p>
    );
  }
  // Colour follows the Flow's slot in the overall ranking, which the ranking
  // fixes for the whole window, so a period's reshuffle never repaints a line.
  const series: BumpChartSeries[] = flows.series.map((flow, i) => ({
    id: flow.name,
    name: flow.name,
    ranks: flow.ranks,
    color: RANK_COLORS[i],
  }));
  const periods = flows.periods.map((p) => (flows.granularity === "week" ? `w/c ${shortDay(p)}` : shortDay(p)));
  // The plot is an SVG that scales with its box, text included: capped, its
  // labels stay the size of the rest of the page on a wide card.
  return <BumpChart series={series} periods={periods} label="Most used Flows" className="mx-auto max-w-3xl" />;
}

const LATENCY_CONFIG = {
  p50: { label: "p50", color: "#2a78d6" },
  p95: { label: "p95", color: "#eb6834" },
} satisfies ChartConfig;

/** Median and 95th-percentile turn latency per day, on one axis. */
export function LatencyTrend({ daily }: { daily: DashboardDay[] }) {
  const data = daily.map((d) => ({
    day: shortDay(d.day),
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
          type="monotone"
          stroke="var(--color-p95)"
          fill="var(--color-p95)"
          fillOpacity={0.08}
          strokeWidth={2}
          connectNulls
        />
        <Area
          dataKey="p50"
          type="monotone"
          stroke="var(--color-p50)"
          fill="var(--color-p50)"
          fillOpacity={0.12}
          strokeWidth={2}
          connectNulls
        />
      </AreaChart>
    </ChartContainer>
  );
}
