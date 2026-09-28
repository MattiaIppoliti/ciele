"use client";
// beui.dev/charts/bump-chart, trimmed to what Ciele's callers use.

import { cn } from "@/lib/utils";
import { BumpChartContext, useBumpChartModel, type BumpChartProps } from "./bump-chart/context";
import { BumpChartLegend } from "./bump-chart/legend";
import { BumpChartPlot } from "./bump-chart/plot";

/** The plot above its legend. */
export function BumpChart({ className, ...props }: BumpChartProps) {
  const model = useBumpChartModel(props);
  return (
    <BumpChartContext.Provider value={model}>
      <section aria-label={model.label} className={cn("w-full space-y-5", className)}>
        <BumpChartPlot />
        <BumpChartLegend />
      </section>
    </BumpChartContext.Provider>
  );
}

export type BumpChartSeries = import("./bump-chart/model").BumpSeries;
