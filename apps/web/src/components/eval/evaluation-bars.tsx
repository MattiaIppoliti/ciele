"use client";

import { EChartsBarChart } from "@/components/charts/evilcharts/echarts-bar-chart";
import type { ChartConfig } from "@/components/charts/evilcharts/ui/chart-colors";

/**
 * One Eval metric across the run's models, as horizontal bars: the Insights
 * `StageBars` chart with a model per row. Each model is its own series with a
 * value on its own row only, so every bar keeps the model's colour. Its own
 * module so `next/dynamic` loads ECharts after the dashboard's first paint.
 */
export function MetricBars({
  rows,
  format,
}: {
  rows: Array<{ key: string; model: string; value: number; color: string }>;
  format: (value: number) => string;
}) {
  const config = Object.fromEntries(
    rows.map((row) => [row.key, { label: row.model, colors: { light: [row.color], dark: [row.color] } }]),
  ) satisfies ChartConfig;
  const data = rows.map((row) => ({
    model: row.model,
    ...Object.fromEntries(rows.map((other) => [other.key, other.key === row.key ? row.value : null])),
  }));
  return (
    <EChartsBarChart data={data} config={config} xDataKey="model" layout="horizontal" stackType="stacked" className="h-44 w-full">
      <EChartsBarChart.Grid />
      <EChartsBarChart.YAxis dataKey="model" />
      <EChartsBarChart.XAxis tickFormatter={(value) => format(Number(value))} />
      <EChartsBarChart.Tooltip valueFormatter={(value) => format(value)} />
      {rows.map((row) => (
        <EChartsBarChart.Bar key={row.key} dataKey={row.key} />
      ))}
    </EChartsBarChart>
  );
}
