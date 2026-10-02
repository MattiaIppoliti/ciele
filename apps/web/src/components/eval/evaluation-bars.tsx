"use client";

import { ArcFrame } from "@/components/charts/arc/arc-frame";
import { BarChart } from "@/components/charts/arc/bar-chart/bar-chart";

export function MetricBars({
  rows,
  format,
  label,
}: {
  label: string;
  rows: Array<{ key: string; model: string; value: number; color: string }>;
  format: (value: number) => string;
}) {
  return (
    <ArcFrame>
      <BarChart
        label={label}
        period="This evaluation run"
        height={150}
        showAverage={false}
        categoryLabel="Model"
        averageLabel="Mean across models"
        valueLabel="Model"
        formatValue={format}
        data={rows.map((row) => ({
          key: row.key,
          label: row.model,
          axisLabel: row.model,
          value: row.value,
        }))}
      />
    </ArcFrame>
  );
}
