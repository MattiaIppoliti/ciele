"use client";
// Vendored from EvilCharts, trimmed to what Ciele's callers use.

import {
  buildChartCss,
  getColorsCount,
  type ChartConfig,
} from "@/components/charts/evilcharts/ui/chart-colors";
import {
  flattenColor,
  resolveColors,
  withAlpha,
  type ResolvedColors,
} from "@/components/charts/evilcharts/ui/echarts-chart";
import {
  tooltipBaseOption,
  tooltipIndicatorHtml,
  tooltipRow,
  tooltipShell,
} from "@/components/charts/evilcharts/ui/echarts-tooltip";
import {
  GridComponent,
  TooltipComponent,
  type GridComponentOption,
  type TooltipComponentOption,
} from "echarts/components";
import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FC,
  type ReactNode,
} from "react";
import { LegendOverlay } from "@/components/charts/evilcharts/ui/echarts-legend";
import type { ComposeOption } from "echarts/core";
import { BarChart, type BarSeriesOption } from "echarts/charts";
import { useReducedMotion } from "motion/react";
import * as echarts from "echarts/core";

// Modular registration keeps the bundle lean — only the pieces this chart needs.
echarts.use([BarChart, GridComponent, TooltipComponent]);

type EChartsInstance = ReturnType<typeof echarts.init>;

// The exact option surface this chart uses: bar series, grid and tooltip, plus
// the axis options they pull in as dependencies. Narrower than echarts' full
// EChartsOption, so a misspelled key fails the compile instead of silently
// reaching setOption.
type EChartsOption = ComposeOption<BarSeriesOption | GridComponentOption | TooltipComponentOption>;

// Single-entry views of the composed option's array-or-single fields — the
// modular entry points don't export the axis option types directly.
type ArrayItem<T> = T extends readonly (infer U)[] ? U : T;
type XAxisOption = ArrayItem<NonNullable<EChartsOption["xAxis"]>>;
type YAxisOption = ArrayItem<NonNullable<EChartsOption["yAxis"]>>;

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_BAR_RADIUS = 2;
const BAR_GROW_DURATION = 500; // per-bar grow-in length, in milliseconds
const BAR_STAGGER = 50; // delay between consecutive bars in the reveal, in milliseconds
const SELECTION_DIM = 0.3; // opacity of an unselected series while a selection is active
const HOVER_BLUR = 0.3; // opacity of the non-hovered bars while hover-highlight is on
// Stacked segments would otherwise butt straight into each other and read as one
// solid column. The separation is a REAL gap — transparent spacer series stacked
// between the real ones — not a background-colored border: a border paints on all
// four sides, so it outlines each segment instead of only parting them.
const STACK_SEGMENT_GAP = 4; // separation between stacked segments, in pixels

// Recharts draws its grid at border/50, but SVG dashes render pixel-crisp while
// canvas at 2× DPR spreads a 1px line across device pixels — roughly halving
// perceived intensity. Using the border token's full alpha lands both engines at
// the same apparent brightness.
const GRID_LINE_OPACITY = 1; // dashed value-axis split lines, × border alpha

const GRAY = "rgba(120, 120, 120, 1)";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type StackType = "default" | "stacked";
export type BarLayout = "vertical" | "horizontal";

export interface EChartsBarChartProps<TData extends Record<string, unknown>> {
  data: TData[]; // rows rendered by the chart
  config: ChartConfig; // series colors + labels
  xDataKey?: keyof TData & string; // category key — falls back to the axis dataKey / first free column
  className?: string; // extra classes for the chart container
  stackType?: StackType; // how multiple bars combine
  layout?: BarLayout; // orientation of the bars
  children?: ReactNode; // declarative config: <Bar>, <XAxis>, <YAxis>, <Grid>, <Tooltip>, <Legend>
}

// ─────────────────────────────────────────────────────────────────────────────
// Composible parts — DECLARATIVE CONFIG. Every part renders `null`; the root
// walks `children` by reference (child.type === Bar, …) to collect its props.
// Omit a child and that part does not render.
// ─────────────────────────────────────────────────────────────────────────────

export interface BarProps {
  dataKey: string; // series key — must exist on the data + config
  enableHoverHighlight?: boolean; // dims the other bars while one is hovered
}

/** A single bar series. Renders nothing; the root reads these props. */
const Bar: FC<BarProps> = () => null;

export interface XAxisProps {
  dataKey?: string; // category key — overrides the root xDataKey (vertical layout)
  // Category values are stringified, so the formatter always sees a string.
  tickFormatter?: (value: string, index: number) => string; // formats x tick labels
}

/**
 * The x-axis. Category axis in the default (vertical) layout, value axis when
 * `layout="horizontal"`. Presence shows its tick labels. Renders nothing.
 */
const XAxis: FC<XAxisProps> = () => null;

export interface YAxisProps {
  dataKey?: string; // category key — overrides the root xDataKey (horizontal layout)
  tickFormatter?: (value: string, index: number) => string; // formats y tick labels
}

/**
 * The y-axis. Value axis in the default (vertical) layout, category axis when
 * `layout="horizontal"`. Presence shows its tick labels. Renders nothing.
 */
const YAxis: FC<YAxisProps> = () => null;

/** Presence shows the dashed split lines on the value axis. Renders nothing. */
const Grid: FC = () => null;

export interface TooltipProps {
  valueFormatter?: (value: number, dataKey: string) => string; // formats each row's value (Ciele: currency and durations)
}

/** Presence enables the hover tooltip. Renders nothing. */
const Tooltip: FC<TooltipProps> = () => null;

export interface LegendProps {
  isClickable?: boolean; // lets each entry toggle selection of its series
}

/** Presence enables the HTML legend overlay. Renders nothing. */
const Legend: FC<LegendProps> = () => null;

// ─────────────────────────────────────────────────────────────────────────────
// Children collection — walk the declarative config into plain objects the
// option builder consumes.
// ─────────────────────────────────────────────────────────────────────────────

type BarSeriesConfig = {
  dataKey: string;
  enableHoverHighlight: boolean;
};

type AxisSlot = {
  present: boolean;
  dataKey?: string;
  tickFormatter?: (value: string, index: number) => string;
};
type TooltipSlot = {
  present: boolean;
  valueFormatter?: (value: number, dataKey: string) => string;
};
type LegendSlot = {
  present: boolean;
  isClickable: boolean;
};

type CollectedConfig = {
  bars: BarSeriesConfig[];
  xAxis: AxisSlot;
  yAxis: AxisSlot;
  showGrid: boolean;
  tooltip: TooltipSlot;
  legend: LegendSlot;
};

function collectConfig(children: ReactNode): CollectedConfig {
  const bars: BarSeriesConfig[] = [];
  let xAxis: AxisSlot = { present: false };
  let yAxis: AxisSlot = { present: false };
  let showGrid = false;
  let tooltip: TooltipSlot = { present: false };
  let legend: LegendSlot = { present: false, isClickable: false };

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const type = child.type;

    if (type === Bar) {
      const props = child.props as BarProps;
      bars.push({
        dataKey: props.dataKey,
        enableHoverHighlight: props.enableHoverHighlight ?? false,
      });
    } else if (type === XAxis || type === YAxis) {
      const props = child.props as XAxisProps;
      const slot = { present: true, dataKey: props.dataKey, tickFormatter: props.tickFormatter };
      if (type === XAxis) xAxis = slot;
      else yAxis = slot;
    } else if (type === Grid) {
      showGrid = true;
    } else if (type === Tooltip) {
      const props = child.props as TooltipProps;
      tooltip = { present: true, valueFormatter: props.valueFormatter };
    } else if (type === Legend) {
      const props = child.props as LegendProps;
      legend = { present: true, isClickable: props.isClickable ?? false };
    }
  });

  return { bars, xAxis, yAxis, showGrid, tooltip, legend };
}

// Solid vertical top→bottom color for a series — a plain string when there is
// one color, else a vertical multi-stop LinearGradient in each bar's own box.
function solidVerticalPaint(slots: string[]): string | echarts.graphic.LinearGradient {
  if (slots.length <= 1) return slots[0] ?? GRAY;
  const stops = slots.map((color, i) => ({
    offset: i / (slots.length - 1),
    color: withAlpha(color, 1),
  }));
  return new echarts.graphic.LinearGradient(0, 0, 0, 1, stops);
}

// Pixels per one value-axis unit, read straight off the live coordinate system.
// Returns null before the first layout (no coordinate system yet) — callers fall
// back then. Sizes the stacked-segment gap in data units.
function measureValuePxPerUnit(chart: EChartsInstance, isHorizontal: boolean): number | null {
  const finder = isHorizontal ? { xAxisIndex: 0 } : { yAxisIndex: 0 };
  // convertToPixel throws before the first setOption (no coordinate system yet) and
  // whenever the value axis isn't laid out — treat any failure as "not measurable".
  try {
    const p0 = chart.convertToPixel(finder, 0);
    const p1 = chart.convertToPixel(finder, 1);
    if (typeof p0 !== "number" || typeof p1 !== "number") return null;
    const delta = Math.abs(p1 - p0);
    return Number.isFinite(delta) && delta > 0 ? delta : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Option builders — pure functions from a snapshot context to ECharts option
// fragments. Nothing below touches React state or the chart instance.
// ─────────────────────────────────────────────────────────────────────────────

type OptionBuildContext = {
  data: Record<string, unknown>[];
  config: ChartConfig;
  bars: BarSeriesConfig[];
  isHorizontal: boolean;
  isStacked: boolean;
  selectedDataKey: string | null;
  hasSelection: boolean;
  showGrid: boolean;
  // Category axis is x (vertical layout) or y (horizontal); value axis the other.
  categorySlot: AxisSlot;
  valueSlot: AxisSlot;
  tooltipSlot: TooltipSlot;
  legendSlot: LegendSlot;
  resolved: ResolvedColors;
  categories: string[];
  valuePxPerUnit: number | null; // measured value-axis pixels-per-unit (null pre-layout)
};

// The category + value axes, laid onto x/y per layout. Vertical bars → x is
// category, y is value; horizontal bars → x is value, y is category.
function buildMainAxes(ctx: OptionBuildContext): { xAxis: XAxisOption; yAxis: YAxisOption } {
  const { isHorizontal, showGrid, categories, categorySlot, valueSlot } = ctx;
  const { tokens } = ctx.resolved;

  const axisLabelColor = tokens.mutedForeground;
  const splitLineColor = withAlpha(tokens.border, GRID_LINE_OPACITY);
  // Gridline gray as an opaque color — see flattenColor.
  const tickDotColor = flattenColor(splitLineColor, tokens.background);
  const catFormatter = categorySlot.tickFormatter;
  const valFormatter = valueSlot.tickFormatter;

  // Inert while `name` is unset; kept so the emitted option is unchanged.
  const categoryNameGap = isHorizontal ? 38 : 30;
  const valueNameGap = isHorizontal ? 30 : 38;

  // NOTE: these are left un-annotated so their inferred literal type stays free
  // of an axis-specific `position` — the layout swap below assigns the category
  // axis to y (and the value axis to x) for horizontal bars, and XAxisOption vs
  // YAxisOption disagree on `position`, so a fixed annotation would reject one
  // branch. `type` is pinned with `as const` to satisfy the axis-kind union.
  const categoryAxis = {
    type: "category" as const,
    // Bars sit BETWEEN ticks.
    boundaryGap: true,
    show: true,
    // The first category reads at the TOP; ECharts' y category axis defaults to
    // bottom-up, so flip it when the category axis is on y.
    inverse: isHorizontal,
    data: categories,
    name: undefined,
    nameLocation: "middle" as const,
    nameGap: categoryNameGap,
    nameTextStyle: { color: axisLabelColor, fontSize: 10 },
    axisLine: { show: false },
    // Tick DOTS: a near-zero-length tick whose round caps form a true circle, in
    // the gridline gray (flattened opaque so the caps don't stack).
    axisTick: {
      show: categorySlot.present,
      length: 0.5,
      // Bars use boundaryGap, so ECharts would drop each tick on the BOUNDARY
      // between two categories. Align them to the labels instead.
      alignWithLabel: true,
      lineStyle: { color: tickDotColor, width: 3, cap: "round" as const },
    },
    splitLine: { show: false },
    axisLabel: {
      show: categorySlot.present,
      color: axisLabelColor,
      fontSize: 10,
      margin: 8,
      formatter: catFormatter
        ? (value: string, index: number) => catFormatter(value, index)
        : undefined,
    },
  };

  // An ECharts axis with `show: false` hides its splitLines too, so keep the axis
  // on whenever <Grid/> is present and gate the LABELS on the slot instead.
  const valueAxis = {
    type: "value" as const,
    show: valueSlot.present || showGrid,
    max: undefined,
    name: undefined,
    nameLocation: "middle" as const,
    nameGap: valueNameGap,
    nameTextStyle: { color: axisLabelColor, fontSize: 10 },
    axisLine: { show: false },
    // Same tick dots as the category axis, beside each value label.
    axisTick: {
      show: valueSlot.present,
      length: 0.5,
      lineStyle: { color: tickDotColor, width: 3, cap: "round" as const },
    },
    splitLine: {
      show: showGrid,
      lineStyle: { color: splitLineColor, type: [3, 3] as [number, number], width: 1 },
    },
    axisLabel: {
      show: valueSlot.present,
      color: axisLabelColor,
      fontSize: 10,
      margin: 8,
      formatter: valFormatter
        ? (value: number, index: number) => valFormatter(String(value), index)
        : undefined,
    },
  };

  return isHorizontal
    ? { xAxis: valueAxis, yAxis: categoryAxis }
    : { xAxis: categoryAxis, yAxis: valueAxis };
}

// Tooltip HTML builder, closed over the build context. Dims by the click
// selection only; there is no axis-pointer line.
function createTooltipFormatter(ctx: OptionBuildContext) {
  const { config, selectedDataKey, tooltipSlot } = ctx;

  return (params: unknown): string => {
    const rows = Array.isArray(params) ? params : [params];
    if (!rows.length) return "";

    const first = rows[0] as { axisValue?: string | number; name?: string };
    // Label shows the RAW axis value (no tick formatter).
    const axisValue = first.axisValue ?? first.name ?? "";
    const label = String(axisValue);

    const body = rows
      .map((param) => {
        const p = param as {
          seriesId?: string;
          seriesName?: string;
          value?: number | string;
        };
        // Internal series (the stack-gap spacers) never surface in the tooltip,
        // nor does a series with no value on this row (null data, see below).
        if (String(p.seriesId ?? "").startsWith("__") || p.value == null) return "";
        const key = p.seriesId ?? p.seriesName ?? "";
        const item = config[key];
        const colorsCount = item ? getColorsCount(item) : 1;
        const labelText = typeof item?.label === "string" ? item.label : (p.seriesName ?? key);
        const dimmed = selectedDataKey != null && selectedDataKey !== key ? " opacity-30" : "";
        const value =
          typeof p.value === "number"
            ? (tooltipSlot.valueFormatter?.(p.value, key) ?? p.value.toLocaleString())
            : String(p.value ?? "");

        return tooltipRow({
          indicatorHtml: tooltipIndicatorHtml(key, colorsCount),
          labelText,
          valueText: value,
          dimmed,
        });
      })
      .join("");

    return tooltipShell({ label, body });
  };
}

function buildTooltipOption(ctx: OptionBuildContext): TooltipComponentOption {
  return {
    ...tooltipBaseOption(ctx.tooltipSlot.present),
    formatter: createTooltipFormatter(ctx),
  };
}

function buildBarSeries(ctx: OptionBuildContext): BarSeriesOption[] {
  const { data, config, bars, isStacked, selectedDataKey, hasSelection, resolved } = ctx;

  const series: BarSeriesOption[] = bars.map((bar) => {
    const key = bar.dataKey;
    const slots = resolved.series[key] ?? [GRAY];
    const isSelected = selectedDataKey === key;
    // A bar dims only when a DIFFERENT series is selected.
    const dim = selectedDataKey === null || isSelected ? 1 : SELECTION_DIM;

    return {
      id: key,
      name: typeof config[key]?.label === "string" ? config[key]?.label : key,
      type: "bar",
      // null stays null: "no bar on this row", which is how one series per
      // category gives each bar its own colour.
      data: data.map((row) => (row[key] === null ? null : Number(row[key]) || 0)),
      stack: isStacked ? "total" : undefined,
      barGap: undefined,
      barCategoryGap: undefined,
      cursor: "default",
      // Selected series ride on top; when a selection is active the rest sink below.
      z: isSelected ? 3 : hasSelection ? 1 : 2,
      label: undefined,
      showBackground: false,
      backgroundStyle: undefined,
      itemStyle: {
        color: solidVerticalPaint(slots),
        borderRadius: DEFAULT_BAR_RADIUS,
        opacity: dim,
      },
      // Hover-highlight uses ECharts-native focus/blur: `self` keeps only the
      // hovered bar lit and dims every other. A click-selection OWNS the dim while
      // it is active, so hover highlighting switches off whenever a selection
      // exists and resumes once it clears.
      emphasis:
        bar.enableHoverHighlight && !hasSelection
          ? { focus: "self" as const, blurScope: "coordinateSystem" as const }
          : { disabled: true },
      blur:
        bar.enableHoverHighlight && !hasSelection
          ? { itemStyle: { opacity: HOVER_BLUR } }
          : undefined,
      // The grow-in envelope, left to right. Only takes effect on the reveal push
      // (top-level `animation: true`); every later push sends `animation: false`.
      animationDuration: BAR_GROW_DURATION,
      animationEasing: "cubicOut",
      animationDelay: (idx: number) => (data.length > 0 ? idx * BAR_STAGGER : 0),
    };
  });

  // Part stacked segments with a REAL gap: a transparent series stacked between
  // each adjacent pair. The spacer's value is in DATA units, so it is derived from
  // the measured pixels-per-unit to keep the gap a constant pixel height. Before
  // the first layout that measurement is null and the gap is skipped; the push
  // re-applies once it exists, in the same frame (see the sync effect).
  const gapUnits =
    isStacked && series.length > 1 && ctx.valuePxPerUnit
      ? STACK_SEGMENT_GAP / ctx.valuePxPerUnit
      : 0;
  if (!gapUnits) return series;

  const spaced: BarSeriesOption[] = [];
  series.forEach((entry, i) => {
    spaced.push(entry);
    if (i === series.length - 1) return;
    spaced.push({
      id: `__stackgap-${i}`,
      type: "bar",
      stack: "total",
      // Only between two real segments: a row whose neighbours are null (one
      // series per category) gets no gap, or its bar would start off the axis.
      data: data.map((_, row) =>
        series[i]?.data?.[row] != null &&
        series.slice(i + 1).some((next) => next.data?.[row] != null)
          ? gapUnits
          : 0,
      ),
      itemStyle: { color: "transparent" },
      silent: true,
      tooltip: { show: false },
      legendHoverLink: false,
      emphasis: { disabled: true },
      animation: false,
      z: 1,
    });
  });
  return spaced;
}

// Live imperative state: what the theme/resize repushes read or write OUTSIDE
// the React render cycle, grouped in one ref-stable object.
type LiveState = {
  resolved: ResolvedColors | null; // colors read off the live DOM, fed to builds
  hasRevealed: boolean; // the intro grow-in already played on this chart instance
  valuePxPerUnit: number | null; // measured value-axis pixels-per-unit; sizes the stack gap
  // Update-style re-push for paths that bypass React entirely (theme flips,
  // resizes) — set by the sync effect.
  repush: () => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apache ECharts port of the EvilCharts bar chart, exposing a compound-as-config
 * API: every visual part (`<Bar>`, `<XAxis>`, `<YAxis>`, `<Grid>`, `<Tooltip>`,
 * `<Legend>`) is a declarative child that renders nothing. The root walks those
 * children by reference and drives a single imperative ECharts instance.
 */
export function EChartsBarChart<TData extends Record<string, unknown>>({
  data,
  config,
  xDataKey,
  className,
  stackType = "default",
  layout = "vertical",
  children,
}: EChartsBarChartProps<TData>) {
  const rawId = useId();
  const chartId = `chart-${rawId.replace(/:/g, "")}`;

  const containerRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const echartsRef = useRef<EChartsInstance | null>(null);

  // The single imperative surface (see LiveState). Its identity is stable for the
  // component's lifetime.
  const live = useRef<LiveState>({
    resolved: null,
    hasRevealed: false,
    valuePxPerUnit: null,
    repush: () => {},
  }).current;

  const shouldReduceMotion = useReducedMotion();

  const [selectedDataKey, setSelectedDataKey] = useState<string | null>(null);

  // ── Declarative config, collected from children by reference ─────────────────
  const collected = useMemo(() => collectConfig(children), [children]);
  const {
    bars,
    xAxis: xAxisSlot,
    yAxis: yAxisSlot,
    showGrid,
    tooltip: tooltipSlot,
    legend: legendSlot,
  } = collected;

  const isHorizontal = layout === "horizontal";
  const isStacked = stackType === "stacked";

  // Category axis is x when vertical, y when horizontal; value axis the other.
  const categorySlot = isHorizontal ? yAxisSlot : xAxisSlot;
  const valueSlot = isHorizontal ? xAxisSlot : yAxisSlot;

  const seriesKeys = useMemo(() => bars.map((bar) => bar.dataKey), [bars]);

  // category key: category axis dataKey → root xDataKey → first data column no <Bar> claims.
  const categoryKey = useMemo(() => {
    if (categorySlot.dataKey) return categorySlot.dataKey;
    if (xDataKey) return xDataKey as string;
    const firstRow = data[0];
    if (firstRow) {
      const claimed = new Set(seriesKeys);
      const found = Object.keys(firstRow).find((key) => !claimed.has(key));
      if (found) return found;
    }
    return "";
  }, [categorySlot.dataKey, xDataKey, data, seriesKeys]);

  const css = useMemo(() => buildChartCss(chartId, config), [chartId, config]);

  const hasSelection = selectedDataKey !== null;

  const toggleSelection = useCallback((key: string) => {
    setSelectedDataKey((prev) => (prev === key ? null : key));
  }, []);

  // ── Option builder ─────────────────────────────────────────────────────────
  const buildOption = useCallback((): EChartsOption => {
    const resolved = live.resolved;
    if (!resolved) return {};

    const ctx: OptionBuildContext = {
      data,
      config,
      bars,
      isHorizontal,
      isStacked,
      selectedDataKey,
      hasSelection,
      showGrid,
      categorySlot,
      valueSlot,
      tooltipSlot,
      legendSlot,
      resolved,
      categories: data.map((row) => String(row[categoryKey])),
      valuePxPerUnit: live.valuePxPerUnit,
    };

    const { xAxis, yAxis } = buildMainAxes(ctx);

    return {
      animation: false,
      // ECharts 6 contains axis labels automatically.
      grid: { left: 8, right: 8, top: legendSlot.present ? 42 : 16, bottom: 8 },
      xAxis,
      yAxis,
      tooltip: buildTooltipOption(ctx),
      series: buildBarSeries(ctx),
    };
  }, [
    live,
    data,
    config,
    bars,
    categoryKey,
    isHorizontal,
    isStacked,
    selectedDataKey,
    hasSelection,
    showGrid,
    categorySlot,
    valueSlot,
    tooltipSlot,
    legendSlot,
  ]);

  // ── Init + resize + theme observer ──────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    const container = containerRef.current;
    if (!mount || !container) return;

    const chart = echarts.init(mount, null, { renderer: "canvas" });
    echartsRef.current = chart;

    const resizeObserver = new ResizeObserver(() => {
      // Observers always fire once right after observe(). Repushing on that
      // no-op fire would land one frame into the intro and stomp the grow-in —
      // only react when the renderer size actually changed.
      if (mount.clientWidth === chart.getWidth() && mount.clientHeight === chart.getHeight()) {
        return;
      }
      chart.resize();
      live.repush();
    });
    resizeObserver.observe(mount);

    // Light/dark flips change no React state — re-resolve and push directly.
    const themeObserver = new MutationObserver(() => {
      live.repush();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      chart.dispose();
      echartsRef.current = null;
      // The measurement belongs to the disposed painter.
      live.valuePxPerUnit = null;
      // The reveal guard belongs to the chart instance it guarded. Without this
      // reset, StrictMode's dev-only mount→unmount→remount plays the entrance on
      // the throwaway instance and the surviving one renders without it.
      live.hasRevealed = false;
    };
  }, [live]);

  // ── Sync ECharts with props/theme/selection — resolve, build, push ────────────
  useEffect(() => {
    const chart = echartsRef.current;
    const container = containerRef.current;
    if (!chart || !container) return;

    // Colors come from the <style> committed just before this effect ran — read
    // them here, right before the push, rather than round-tripping through state.
    live.resolved = resolveColors(container, config, seriesKeys);

    const hasStackGap = isStacked && bars.length > 1;

    const push = (withEntrance: boolean) => {
      // Refresh the value-axis pixel scale before building (after a resize the
      // coordinate system is already updated here). Null before the very first push.
      const measured = measureValuePxPerUnit(chart, isHorizontal);
      if (measured != null) live.valuePxPerUnit = measured;

      const apply = () => {
        const option = buildOption();
        Object.assign(option, {
          animation: withEntrance,
          animationDuration: BAR_GROW_DURATION,
          animationDurationUpdate: 0,
        });
        chart.setOption(option, { notMerge: true });
      };

      apply();

      // The stacked-segment gap can only be sized once a coordinate system has
      // been laid out. Measure now and, if the scale moved, rebuild IMMEDIATELY,
      // still inside this task, before the browser paints, so the corrected chart
      // is the only thing ever shown.
      if (hasStackGap) {
        const scale = measureValuePxPerUnit(chart, isHorizontal);
        if (scale != null && (live.valuePxPerUnit == null || live.valuePxPerUnit !== scale)) {
          live.valuePxPerUnit = scale;
          apply();
        }
      }
    };

    // Intro grow-in: ECharts' native bar entrance, enabled only for the first
    // render: every later push (selection, theme) applies instantly, since
    // notMerge would otherwise replay the entrance on each.
    const shouldReveal = !live.hasRevealed;
    if (shouldReveal) live.hasRevealed = true;
    push(shouldReveal && !shouldReduceMotion);

    // Theme flips and resizes re-enter here without touching React: re-read the
    // tokens and push an update-style option.
    live.repush = () => {
      live.resolved = resolveColors(container, config, seriesKeys);
      push(false);
    };
  }, [live, buildOption, shouldReduceMotion, config, seriesKeys, bars, isStacked, isHorizontal]);

  // Insets match the Recharts legend's breathing room inside the plot frame.
  const legendStyle: CSSProperties = {
    position: "absolute",
    left: 16,
    right: 16,
    pointerEvents: "auto",
    top: 12,
  };

  return (
    <div
      ref={containerRef}
      data-chart={chartId}
      className={`relative flex flex-col text-xs ${className ?? ""}`}
    >
      <style dangerouslySetInnerHTML={{ __html: css }} />

      <div className="relative min-h-0 w-full flex-1">
        <div ref={mountRef} className="h-full min-h-0 w-full" />
      </div>

      {legendSlot.present && (
        <LegendOverlay
          seriesKeys={seriesKeys}
          config={config}
          selectedKey={selectedDataKey}
          isClickable={legendSlot.isClickable}
          onToggle={toggleSelection}
          style={legendStyle}
        />
      )}
    </div>
  );
}

// Compound API: every part hangs off the root as a static member, so a consumer
// writes <EChartsBarChart.Bar/>, <EChartsBarChart.Tooltip/>, … from a single import.
EChartsBarChart.Bar = Bar;
EChartsBarChart.XAxis = XAxis;
EChartsBarChart.YAxis = YAxis;
EChartsBarChart.Grid = Grid;
EChartsBarChart.Tooltip = Tooltip;
EChartsBarChart.Legend = Legend;
