"use client";

import { EvilPieChart } from "@/components/charts/evilcharts/recharts-pie-chart";
import type { ChartConfig } from "@/components/charts/evilcharts/ui/chart-colors";
import { formatCount } from "@/lib/format";
import { OUTCOME_COLORS } from "./palette";

/**
 * A two-part rate (turns that succeeded and failed, answers that passed and
 * failed, conversations resolved and escalated) as the evilcharts donut, with
 * the headline share in the hole. `loading` is the chart's own skeleton,
 * shown while a filter change is being fetched, so the ring never shows the
 * previous filter's split under the new filter's heading.
 */
export function RateDonut({
  good,
  bad,
  goodLabel,
  badLabel,
  title,
  loading,
}: {
  good: number;
  bad: number;
  goodLabel: string;
  badLabel: string;
  title: string;
  loading: boolean;
}) {
  const config = {
    good: { label: goodLabel, colors: { light: [OUTCOME_COLORS.good.light], dark: [OUTCOME_COLORS.good.dark] } },
    bad: { label: badLabel, colors: { light: [OUTCOME_COLORS.bad.light], dark: [OUTCOME_COLORS.bad.dark] } },
  } satisfies ChartConfig;
  const data = [
    { outcome: "good", count: good },
    { outcome: "bad", count: bad },
  ];
  const total = good + bad;
  const share = total > 0 ? Math.round((good / total) * 100) : 0;
  return (
    <div className="flex items-center gap-4">
      <div className="relative size-36 shrink-0">
        <EvilPieChart
          className="size-full"
          data={data}
          dataKey="count"
          nameKey="outcome"
          config={config}
          isLoading={loading}
        >
          <EvilPieChart.Tooltip />
          <EvilPieChart.Pie isClickable innerRadius={44} paddingAngle={bad > 0 ? 3 : 0} cornerRadius={4} />
        </EvilPieChart>
        {!loading && (
          <span
            aria-label={`${title}: ${share}%`}
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-xl font-semibold tabular-nums"
          >
            {share}%
          </span>
        )}
      </div>
      {/* The legend carries the counts, so identity is never colour alone. */}
      <dl className="grid gap-2 text-sm">
        {(
          [
            ["good", goodLabel, good],
            ["bad", badLabel, bad],
          ] as const
        ).map(([key, label, count]) => (
          <div key={key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: OUTCOME_COLORS[key].light }}
            />
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium tabular-nums">{formatCount(count)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
