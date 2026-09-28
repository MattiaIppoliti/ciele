// Vendored from EvilCharts, trimmed to what Ciele's callers use.
import { indicatorBackground } from "@/components/charts/evilcharts/ui/chart-colors";
import type { TooltipComponentOption } from "echarts/components";

// ─────────────────────────────────────────────────────────────────────────────
// Tooltip — the shared HTML shell/row primitives and the chart-agnostic option
// fields. The tooltip DOM lives inside `[data-chart={id}]`, so the injected
// `--color-*` vars and Tailwind classes resolve directly (no color read).
// ─────────────────────────────────────────────────────────────────────────────

// The standard series indicator swatch — a rounded square filled with the
// series' solid var or multi-stop gradient (indicatorBackground).
export function tooltipIndicatorHtml(key: string, colorsCount: number): string {
  return `<div class="h-2.5 w-2.5 shrink-0 rounded-[2px]" style="background:${indicatorBackground(key, colorsCount)}"></div>`;
}

// One tooltip row: indicator swatch + label/value pair. `dimmed` is a class
// fragment (e.g. " opacity-30") appended to the row.
export function tooltipRow({
  indicatorHtml,
  labelText,
  valueText,
  dimmed,
}: {
  indicatorHtml: string;
  labelText: string;
  valueText: string;
  dimmed: string;
}): string {
  return `<div class="flex w-full flex-wrap items-center gap-2${dimmed}">
          ${indicatorHtml}
          <div class="flex flex-1 items-center justify-between gap-4 leading-none">
            <span class="text-muted-foreground">${labelText}</span>
            <span class="text-foreground font-mono font-medium tabular-nums">${valueText}</span>
          </div>
        </div>`;
}

// The outer tooltip surface wrapping the axis label and the composed rows.
export function tooltipShell({ label, body }: { label: string; body: string }): string {
  return `<div class="grid min-w-32 items-start gap-1.5 border border-border/50 px-2.5 py-1.5 text-xs shadow-xl rounded-lg bg-background">
      <div class="font-medium text-primary">${label}</div>
      <div class="grid gap-1.5">${body}</div>
    </div>`;
}

// The chart-agnostic tooltip option fields. The chart supplies only `formatter`
// and spreads this in. No cursor: no shadow, no axis-pointer line.
export function tooltipBaseOption(present: boolean): TooltipComponentOption {
  return {
    show: present,
    trigger: "axis",
    confine: true,
    displayTransition: false,
    backgroundColor: "transparent",
    borderWidth: 0,
    padding: 0,
    extraCssText: "box-shadow:none;",
    axisPointer: { type: "none" },
  };
}
