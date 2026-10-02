"use client";

import type { UsageDashboard } from "@agent-hub/core";
import { ArcFrame } from "@/components/charts/arc/arc-frame";
import { SlopeChart } from "@/components/charts/arc/slope-chart/slope-chart";
import { Treemap } from "@/components/charts/arc/treemap/treemap";
import {
  modelSpendTree,
  rateComparisons,
} from "@/lib/insights/chart-comparisons";
import { formatEur } from "@/lib/insights/dashboard-view";

export function ModelSpendTree({
  models,
}: {
  models: UsageDashboard["models"];
}) {
  return (
    <ArcFrame>
      <Treemap
        data={modelSpendTree(models)}
        label="Estimated spend by provider and model"
        height={300}
        formatValue={formatEur}
        emptyLabel="No estimated model spend in this range."
      />
    </ArcFrame>
  );
}

export function RateComparison({
  current,
  previous,
}: {
  current: UsageDashboard["totals"];
  previous: UsageDashboard["totals"] | null;
}) {
  return (
    <ArcFrame>
      <SlopeChart
        data={rateComparisons(current, previous)}
        label="Rates compared with the prior period"
        startLabel="Prior period"
        endLabel="Current period"
        ranks={false}
        height={220}
        formatValue={(value) => `${value.toFixed(1)}%`}
        formatChange={(value) =>
          `${value >= 0 ? "+" : ""}${value.toFixed(1)} percentage points`
        }
        emptyLabel="No matching measurements in both periods."
      />
    </ArcFrame>
  );
}
