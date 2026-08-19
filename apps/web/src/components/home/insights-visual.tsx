"use client";

import { Visual3 } from "@/components/core/visual-3";

/**
 * Insights card visual: the badtz-ui "Visual 3" animated bar chart in neutral
 * grey tones (instead of the demo's orange). `group/animated-card` scopes the
 * hover reveal of the chart's overlay layers to this visual area.
 */
export function InsightsVisual() {
  return (
    <div className="group/animated-card bg-card relative flex h-[180px] items-center justify-center overflow-hidden">
      <Visual3
        mainColor="#71717a"
        secondaryColor="#a1a1aa"
        gridColor="#8080801f"
      />
    </div>
  );
}
