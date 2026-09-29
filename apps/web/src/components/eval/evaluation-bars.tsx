"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

/**
 * One Eval metric across the run's models, as horizontal bars. Each model is
 * its own series with a value on its own row only, stacked, so every bar keeps
 * the model's colour. Its own module so `next/dynamic` loads Recharts after
 * the dashboard's first paint.
 */
export function MetricBars({
  rows,
  format,
}: {
  rows: Array<{ key: string; model: string; value: number; color: string }>;
  format: (value: number) => string;
}) {
  const config = Object.fromEntries(
    rows.map((row) => [row.key, { label: row.model, color: row.color }]),
  ) satisfies ChartConfig;
  const data = rows.map((row) => ({
    model: row.model,
    ...Object.fromEntries(rows.map((other) => [other.key, other.key === row.key ? row.value : null])),
  }));
  return (
    <ChartContainer config={config} className="aspect-auto h-44 w-full">
      <BarChart data={data} layout="vertical" accessibilityLayer>
        <CartesianGrid horizontal={false} />
        <YAxis dataKey="model" type="category" tickLine={false} axisLine={false} width={120} />
        <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(value) => format(Number(value))} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(value, name) => (
                <span className="flex w-full justify-between gap-3">
                  <span className="text-muted-foreground">{config[String(name)]?.label ?? name}</span>
                  <span className="font-mono font-medium tabular-nums">{format(Number(value))}</span>
                </span>
              )}
            />
          }
        />
        {rows.map((row) => (
          <Bar key={row.key} dataKey={row.key} fill={`var(--color-${row.key})`} stackId="a" />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
