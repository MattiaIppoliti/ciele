"use client";
// beui.dev/charts/composition-chart, trimmed to what Ciele's callers use.

import { cn } from "@/lib/utils";
import {
  CompositionContext,
  useCompositionModel,
  type CompositionChartProps,
} from "./composition-chart/context";
import { CompositionChartPlot } from "./composition-chart/plot";
import { CompositionChartLegend } from "./composition-chart/legend";

/** Normalized stacked shares. Zero-total or incomplete periods are shown as gaps. */
export function CompositionChart({ className, ...props }: CompositionChartProps) {
  const model = useCompositionModel(props);
  return (
    <CompositionContext.Provider value={model}>
      <section aria-label={model.label} className={cn("@container w-full space-y-4", className)}>
        <div className="grid gap-4">
          <CompositionChartPlot />
          <CompositionChartLegend />
        </div>
      </section>
    </CompositionContext.Provider>
  );
}
