"use client";

import type { EvaluationRun } from "@agent-hub/core";
import { AnalyticsCard } from "@/components/insights/analytics-card";
import { ArcFrame } from "@/components/charts/arc/arc-frame";
import { Ridgeline } from "@/components/charts/arc/ridgeline/ridgeline";
import { evaluationLatencies } from "@/lib/insights/chart-comparisons";

export function EvaluationDistributions({
  run,
  labels,
}: {
  run: EvaluationRun;
  labels: Record<string, string>;
}) {
  const series = evaluationLatencies(run, labels);
  const maximum = series.reduce(
    (max, row) => row.values.reduce((m, value) => Math.max(m, value), max),
    0,
  );
  return (
    <AnalyticsCard title="Latency distribution by model"
      description="Compare spread and long tails, beyond the average. Includes technical failures; curves smooth the recorded observations and are exploratory with fewer than 20 samples.">
      <p className="mb-4 text-xs text-muted-foreground">
        {series
          .map((row) => `${row.label}: ${row.values.length} observations`)
          .join(" · ")}
      </p>
      <ArcFrame>
        <Ridgeline
          series={series}
          label="Evaluation latency distributions by model"
          domain={[0, Math.max(1, maximum * 1.05)]}
          rowHeight={46}
          formatValue={(value) => `${Math.round(value)} ms`}
          emptyLabel="No model has two latency observations yet. Inspect individual executions in Results by question."
        />
      </ArcFrame>
    </AnalyticsCard>
  );
}
