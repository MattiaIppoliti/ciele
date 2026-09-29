"use client";

import { Cell, Pie, PieChart } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatCount } from "@/lib/format";
import { OUTCOME_COLORS } from "./palette";

/**
 * A two-part rate (turns that succeeded and failed, answers that passed and
 * failed, conversations resolved and escalated) as a donut, with
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
    good: { label: goodLabel, theme: OUTCOME_COLORS.good },
    bad: { label: badLabel, theme: OUTCOME_COLORS.bad },
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
        <ChartContainer config={config} className="aspect-auto size-full" aria-busy={loading}>
          <PieChart>
            <ChartTooltip cursor={false} content={<ChartTooltipContent nameKey="outcome" hideLabel />} />
            <Pie
              data={loading ? [] : data}
              dataKey="count"
              nameKey="outcome"
              innerRadius={44}
              outerRadius="100%"
              paddingAngle={bad > 0 ? 3 : 0}
              cornerRadius={4}
              strokeWidth={0}
            >
              {data.map((d) => (
                <Cell key={d.outcome} fill={`var(--color-${d.outcome})`} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
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
