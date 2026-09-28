"use client";
// Vendored from EvilCharts, trimmed to what Ciele's callers use.

import { getColorsCount, indicatorBackground, type ChartConfig } from "@/components/charts/evilcharts/ui/chart-colors";
import type { CSSProperties } from "react";

function legendFillStyle(key: string, colorsCount: number): CSSProperties {
  if (colorsCount <= 1) return { backgroundColor: `var(--color-${key}-0)` };
  return { background: indicatorBackground(key, colorsCount) };
}

// ─────────────────────────────────────────────────────────────────────────────
// LegendOverlay: the positioned HTML legend row (rounded-square indicators,
// right-aligned). The chart computes the absolute-positioned `style` and passes
// it in; this renders the entries, their indicators, and the selection dim. The
// legend is HTML inside `[data-chart={id}]`, so it uses the injected `--color-*`
// vars directly.
// ─────────────────────────────────────────────────────────────────────────────

type LegendOverlayProps = {
  seriesKeys: string[];
  config: ChartConfig;
  selectedKey: string | null;
  isClickable: boolean;
  onToggle: (key: string) => void;
  style: CSSProperties;
};

export function LegendOverlay({
  seriesKeys,
  config,
  selectedKey,
  isClickable,
  onToggle,
  style,
}: LegendOverlayProps) {
  return (
    <div style={style} className="flex items-center gap-4 select-none justify-end">
      {seriesKeys.map((key) => {
        const item = config[key];
        const colorsCount = item ? getColorsCount(item) : 1;
        const isSelected = selectedKey === null || selectedKey === key;
        return (
          // No entrance here: a fade-in reads as disconnected from the canvas draw-in.
          <div
            key={key}
            className={`flex items-center gap-1.5 transition-opacity ${
              !isSelected ? "opacity-30" : ""
            } ${isClickable ? "cursor-pointer" : ""}`}
            onClick={() => {
              if (isClickable) onToggle(key);
            }}
          >
            <div className="h-2 w-2 shrink-0 rounded-[2px]" style={legendFillStyle(key, colorsCount)} />
            {item?.label}
          </div>
        );
      })}
    </div>
  );
}
