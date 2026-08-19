"use client";

import NumberFlow from "@number-flow/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import {
  AlertTriangle,
  BarChart3,
  LineChart,
  RotateCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { APPEARANCES, type AppearanceTokens } from "./appearances";
import { cn } from "./cn";
import { DotChart, type DotChartProps } from "./dot-chart";
import { clamp } from "./helpers";
import { PALETTES } from "./palettes";
import type {
  CardAppearance,
  DotChartActivePoint,
  DotChartDataPoint,
  DotChartStatus,
  DotSection,
  TrendDirection,
} from "./types";

const TOOLTIP_SPRING = { stiffness: 420, damping: 32, mass: 0.52 } as const;
const LINE_SPRING = { stiffness: 360, damping: 30, mass: 0.68 } as const;
const TOOLTIP_ENTER_SPRING = {
  type: "spring" as const,
  stiffness: 420,
  damping: 26,
  mass: 0.5,
};

/* ═══════════════════════════════════════════════════════════════
   Switch primitive: headless button with role="switch".

   Visual language is iOS-ish (pill track, colored fill when active, thumb
   with matching border). Implemented as a plain button to avoid adding
   new dependencies; follows the APG switch pattern for accessibility.
   ═══════════════════════════════════════════════════════════════ */

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  ariaLabel?: string;
  trackOffClass: string;
  disabled?: boolean;
  className?: string;
}

function Switch({
  checked,
  onCheckedChange,
  id,
  ariaLabel,
  trackOffClass,
  disabled = false,
  className,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-[2px]",
        "transition-colors duration-200 ease-out",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#34c759]",
        "active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-[#34c759]" : trackOffClass,
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full border-2 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)]",
          "transition-transform duration-200 ease-out",
          checked
            ? "translate-x-[16px] border-[#34c759]"
            : "translate-x-0 border-transparent",
        )}
      />
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Status states
   ═══════════════════════════════════════════════════════════════ */

function LoadingHeaderOverlay({ subtext }: { subtext: string }) {
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <div
        className={cn(
          "h-3 w-20 animate-pulse rounded bg-current",
          subtext,
          "opacity-20",
        )}
      />
    </div>
  );
}

function EmptyState({ appearance }: { appearance: AppearanceTokens }) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-2 py-10 text-center"
    >
      <LineChart className={cn("h-8 w-8", appearance.subtext)} />
      <p className={cn("text-sm font-medium", appearance.text)}>No data yet</p>
      <p className={cn("text-xs", appearance.subtext)}>
        Once data arrives, the trend will appear here.
      </p>
    </div>
  );
}

interface ErrorStateProps {
  appearance: AppearanceTokens;
  message: string;
  onRetry?: () => void;
}

function ErrorState({ appearance, message, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-2 py-10 text-center"
    >
      <AlertTriangle className="h-8 w-8 text-rose-500" />
      <p className={cn("text-sm font-medium", appearance.text)}>
        Something went wrong
      </p>
      <p className={cn("max-w-[32ch] text-xs", appearance.subtext)}>
        {message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            "mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-[transform,background-color] duration-150",
            appearance.retryButton,
          )}
        >
          <RotateCw className="h-3 w-3" />
          Retry
        </button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Legend
   ═══════════════════════════════════════════════════════════════ */

interface LegendProps {
  sections: readonly DotSection[];
  appearance: AppearanceTokens;
  compareLabel?: string;
  currentLabel?: string;
  lineMode: boolean;
  onLineModeChange: (next: boolean) => void;
  switchLabel: string;
  switchId: string;
  showSwitch: boolean;
}

function Legend({
  sections,
  appearance,
  compareLabel,
  currentLabel,
  lineMode,
  onLineModeChange,
  switchLabel,
  switchId,
  showSwitch,
}: LegendProps) {
  const sectionEntries = sections.filter((s) => s.label);
  const showCurrentEntry = lineMode && Boolean(currentLabel);
  const showCompareEntry = lineMode && Boolean(compareLabel);
  const hasAnyEntry =
    sectionEntries.length > 0 || showCurrentEntry || showCompareEntry;

  return (
    <div
      className={cn(
        "flex items-start justify-between gap-x-4 pt-3 text-[12px] font-medium",
        appearance.subtext,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5">
        {sectionEntries.map((section, index) => (
          <div key={`section-${index}`} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="block h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: section.palette.active }}
            />
            <span>{section.label}</span>
          </div>
        ))}
        {showCurrentEntry && (
          <div className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="block h-[2px] w-4 shrink-0 rounded-full"
              style={{ background: appearance.primaryLineStroke }}
            />
            <span>{currentLabel}</span>
          </div>
        )}
        {showCompareEntry && (
          <div className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="block h-[2px] w-4 shrink-0 rounded-full"
              style={{ background: appearance.compareLineStroke }}
            />
            <span>{compareLabel}</span>
          </div>
        )}
        {!hasAnyEntry && <span className="invisible">placeholder</span>}
      </div>

      {showSwitch && (
        <label
          htmlFor={switchId}
          className="flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap select-none"
        >
          <span>{switchLabel}</span>
          <Switch
            id={switchId}
            checked={lineMode}
            onCheckedChange={onLineModeChange}
            ariaLabel={`Toggle ${switchLabel.toLowerCase()} overlay`}
            trackOffClass={appearance.switchTrackOff}
          />
        </label>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MetricGrowthCard: styled composition
   ═══════════════════════════════════════════════════════════════ */

const VIEWPORT_PADDING = 12;

type ChartPropsSubset<TData extends DotChartDataPoint> = Omit<
  Partial<DotChartProps<TData>>,
  "data" | "defaultActiveIndex" | "onActivePointChange" | "compare" | "status"
>;

/**
 * KPI growth card built on the DotChart primitive: header with icon, title,
 * headline value and trend pill; dot-matrix chart with crosshair + floating
 * animated-number tooltip; legend with an optional compare-mode switch that
 * overlays current/previous trend lines.
 *
 * @param props.data - primary time series to visualize.
 * @param props.compare - optional comparison series rendered as line overlay.
 * @param props.status - "idle" | "loading" | "empty" | "error". Required for non-data views.
 * @param props.sections - dot color sections. Defaults to PALETTES.navy.
 * @param props.appearance - card theme. "light" | "dark" | "pastel". Default "light".
 * @param props.trendDirection - colors the trend pill ("up" green, "down" red, "flat" muted).
 * @param props.locale - BCP-47 locale for number formatting. Default "en-US".
 * @param props.currency - ISO 4217 currency code. If set, tooltip values format as currency.
 * @param props.onActivePointChange - callback fired when the active column changes.
 * @param props.onRetry - callback for error-state retry button.
 */
export interface MetricGrowthCardProps<
  TData extends DotChartDataPoint = DotChartDataPoint,
> {
  data: readonly TData[];
  compare?: readonly TData[];
  status?: DotChartStatus;
  title?: ReactNode;
  value?: ReactNode;
  trendValue?: ReactNode;
  trendLabel?: ReactNode;
  trendDirection?: TrendDirection;
  icon?: ReactNode;
  sections?: readonly DotSection[];
  appearance?: CardAppearance;
  showLegend?: boolean;
  compareLabel?: string;
  currentLabel?: string;
  /** Toggle label next to the line-mode switch. Default "Compare". */
  compareToggleLabel?: string;
  /** Controlled line-comparison mode. Omit to use internal state. */
  lineMode?: boolean;
  /** Initial uncontrolled line-mode value. Default false. */
  defaultLineMode?: boolean;
  /** Fires when the line-mode switch toggles. */
  onLineModeChange?: (next: boolean) => void;
  locale?: string;
  currency?: string;
  tooltipPrefix?: string;
  defaultActiveIndex?: number;
  className?: string;
  errorMessage?: string;
  onRetry?: () => void;
  onActivePointChange?: (point: DotChartActivePoint<TData>) => void;
  getTooltipValue?: (point: TData) => number;
  getTooltipLabel?: (point: TData) => ReactNode;
  chartProps?: ChartPropsSubset<TData>;
  ariaLabel?: string;
}

export function MetricGrowthCard<
  TData extends DotChartDataPoint = DotChartDataPoint,
>({
  data,
  compare,
  status: statusProp,
  title = "Growth",
  value,
  trendValue,
  trendLabel,
  trendDirection = "up",
  icon,
  sections = PALETTES.navy,
  appearance: appearanceKey = "light",
  showLegend,
  compareLabel = "Previous",
  currentLabel = "Current",
  compareToggleLabel = "Compare",
  lineMode: lineModeProp,
  defaultLineMode = false,
  onLineModeChange,
  locale = "en-US",
  currency,
  tooltipPrefix,
  defaultActiveIndex,
  className,
  errorMessage = "We couldn't load this metric. Please try again.",
  onRetry,
  onActivePointChange,
  getTooltipValue = (point) => point.value,
  getTooltipLabel = (point) => point.label,
  chartProps,
  ariaLabel,
}: MetricGrowthCardProps<TData>) {
  // Line-mode state supports both controlled (`lineMode` prop) and
  // uncontrolled (`defaultLineMode`) usage. When controlled, local state is
  // a write-through mirror so the switch stays responsive if the parent
  // forwards the change synchronously.
  const [internalLineMode, setInternalLineMode] = useState(defaultLineMode);
  const lineMode = lineModeProp ?? internalLineMode;
  const handleLineModeChange = useCallback(
    (next: boolean) => {
      if (lineModeProp === undefined) setInternalLineMode(next);
      onLineModeChange?.(next);
    },
    [lineModeProp, onLineModeChange],
  );
  const switchId = useId();
  const appearance = APPEARANCES[appearanceKey];
  const prefersReducedMotion = useReducedMotion();
  const disableAnimation = prefersReducedMotion ?? false;

  const effectiveStatus: DotChartStatus =
    statusProp ?? (data.length === 0 ? "empty" : "idle");

  const chartRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const [tooltipWidth, setTooltipWidth] = useState(0);
  const [tooltipSide, setTooltipSide] = useState<"top" | "bottom">("top");
  const [isHovering, setIsHovering] = useState(true);
  const [activePoint, setActivePoint] =
    useState<DotChartActivePoint<TData> | null>(null);

  const handleActivePointChange = useCallback(
    (point: DotChartActivePoint<TData>) => {
      setIsHovering(true);
      // Bail out of re-render when the point hasn't meaningfully changed.
      // Prevents effect feedback loops if upstream emits on every render.
      setActivePoint((prev) =>
        prev &&
        prev.columnIndex === point.columnIndex &&
        prev.dataIndex === point.dataIndex
          ? prev
          : point,
      );
      onActivePointChange?.(point);
    },
    [onActivePointChange],
  );

  const handlePointerLeave = useCallback(() => {
    setIsHovering(false);
  }, []);

  const mergedChartProps = useMemo<ChartPropsSubset<TData>>(
    () => ({ rows: 14, ...chartProps }),
    [chartProps],
  );
  const resolvedDotSize = Math.max(1, mergedChartProps.dotSize ?? 4);
  const resolvedGap = Math.max(0, mergedChartProps.gap ?? 5);
  const defaultIndex = clamp(
    defaultActiveIndex ?? Math.max(data.length - 2, 0),
    0,
    Math.max(data.length - 1, 0),
  );

  const visibleDataPoint = activePoint?.dataPoint ?? data[defaultIndex] ?? null;
  const tooltipValue = visibleDataPoint ? getTooltipValue(visibleDataPoint) : 0;
  const tooltipLabel = visibleDataPoint
    ? getTooltipLabel?.(visibleDataPoint)
    : null;

  const compareDataPoint = useMemo(() => {
    if (!compare || !visibleDataPoint) return null;
    const index = activePoint?.dataIndex ?? defaultIndex;
    return compare[Math.min(index, compare.length - 1)] ?? null;
  }, [compare, visibleDataPoint, activePoint?.dataIndex, defaultIndex]);

  // NumberFlow's Format type excludes scientific/engineering notation,
  // so we narrow from Intl.NumberFormatOptions to the subset it accepts.
  const tooltipFormat = useMemo(
    () =>
      currency
        ? {
            style: "currency" as const,
            currency,
            maximumFractionDigits: 0,
          }
        : { maximumFractionDigits: 0 },
    [currency],
  );

  const resolvedTooltipPrefix = tooltipPrefix ?? "";

  const anchorX = useMotionValue(0);
  const tooltipX = useSpring(anchorX, TOOLTIP_SPRING);
  const lineX = useSpring(anchorX, LINE_SPRING);
  const clampedTooltipX = useTransform(tooltipX, (x) => {
    const half = tooltipWidth / 2;
    return clamp(x, half, Math.max(chartWidth - half, half));
  });

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) =>
      setChartWidth(entry.contentRect.width),
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const el = tooltipRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) =>
      setTooltipWidth(entry.contentRect.width),
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Tooltip viewport flipping: decide side from the CHART container, not
  // the card. The tooltip is anchored at `top: -16px` of chartRef (plus a
  // -12px hover lift), so its top edge sits 28px above chartRef.top. The
  // card has a header above the chart, so cardRect.top can be near the
  // viewport top while chartRef.top is still well within it. Using chartRef
  // here also avoids the feedback oscillation that would happen with
  // tooltip-relative bounds.
  useEffect(() => {
    if (!chartRef.current) return;
    const chartRect = chartRef.current.getBoundingClientRect();
    const tooltipTopOffset = 28;
    const canFitAbove = chartRect.top > tooltipTopOffset + VIEWPORT_PADDING;
    setTooltipSide(canFitAbove ? "top" : "bottom");
  }, [activePoint, tooltipWidth]);

  useLayoutEffect(() => {
    if (activePoint) {
      anchorX.set(activePoint.x);
      return;
    }
    if (chartWidth === 0 || data.length === 0) return;
    const cellSize = resolvedDotSize + resolvedGap;
    const cols = Math.max(1, Math.floor(chartWidth / cellSize));
    const col =
      cols <= 1 || data.length <= 1
        ? 0
        : Math.round((defaultIndex / (data.length - 1)) * (cols - 1));
    anchorX.set(col * cellSize + cellSize / 2);
  }, [
    activePoint,
    anchorX,
    chartWidth,
    data.length,
    defaultIndex,
    resolvedDotSize,
    resolvedGap,
  ]);

  useEffect(() => {
    if (effectiveStatus !== "idle") {
      setActivePoint(null);
    }
  }, [effectiveStatus]);

  // Legend always renders when compare data is present (it hosts the line
  // toggle). Otherwise it's driven by section labels.
  const hasCompare = Boolean(compare);
  const shouldShowLegend =
    showLegend ?? (hasCompare || sections.some((s) => s.label !== undefined));
  const shouldShowChart =
    effectiveStatus === "idle" || effectiveStatus === "loading";

  const TrendIcon =
    trendDirection === "down"
      ? TrendingDown
      : trendDirection === "flat"
        ? null
        : TrendingUp;
  const trendClasses =
    trendDirection === "down"
      ? cn(
          appearance.trendDownBorder,
          appearance.trendDownBg,
          appearance.trendDownText,
        )
      : trendDirection === "flat"
        ? cn("border-current/20", appearance.subtext)
        : cn(appearance.trendBorder, appearance.trendBg, appearance.trendText);

  return (
    <div
      ref={cardRef}
      className={cn(
        // overflow-clip (not overflow-hidden), both visually clip descendants,
        // but clip also prevents the card from becoming a scroll container.
        // This matters because the decorative glow div extends ~80px past the
        // card's right edge; with overflow-hidden, that extra width contributes
        // to scrollWidth and focus-in-view auto-scroll can shift the entire
        // content horizontally, breaking the legend alignment.
        "relative w-full select-none overflow-clip rounded-2xl p-4 md:p-5",
        appearance.card,
        className,
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -top-15 -right-15 z-0 size-30 blur-3xl",
          appearance.glow,
        )}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(${appearance.gridLineColor} 1px, transparent 1px), linear-gradient(90deg, ${appearance.gridLineColor} 1px, transparent 1px)`,
          backgroundSize: "20px 20px",
        }}
      />

      <div className="relative z-10 mb-4 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex size-8 items-center justify-center rounded-lg",
              appearance.iconBg,
            )}
          >
            {icon ?? <BarChart3 className={cn("h-5 w-5", appearance.iconFg)} />}
          </div>
          <span
            className={cn(
              "truncate text-base font-light tracking-tight md:text-lg",
              appearance.text,
            )}
          >
            {title}
          </span>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          {effectiveStatus === "loading" ? (
            <LoadingHeaderOverlay subtext={appearance.subtext} />
          ) : (
            <>
              {value != null && (
                <span
                  className={cn(
                    "font-mono text-2xl font-bold leading-none tabular-nums",
                    appearance.text,
                  )}
                >
                  {value}
                </span>
              )}
              {(trendValue != null || trendLabel != null) && (
                <div className="flex flex-col-reverse items-end gap-2 md:flex-row md:items-center">
                  {trendValue != null && (
                    <div
                      className={cn(
                        "flex items-center gap-1 rounded-full border px-2 py-0.5",
                        trendClasses,
                      )}
                    >
                      {TrendIcon && <TrendIcon className="h-3 w-3" />}
                      <span className="text-xs font-semibold">
                        {trendValue}
                      </span>
                    </div>
                  )}
                  {trendLabel != null && (
                    <span
                      className={cn("truncate text-xs", appearance.subtext)}
                    >
                      {trendLabel}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div ref={chartRef} className="relative">
        {effectiveStatus === "empty" && <EmptyState appearance={appearance} />}

        {effectiveStatus === "error" && (
          <ErrorState
            appearance={appearance}
            message={errorMessage}
            onRetry={onRetry}
          />
        )}

        {shouldShowChart && (
          <>
            {effectiveStatus === "idle" && (
              <motion.div
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-y-0 z-0 w-px border-l border-dashed",
                  appearance.dashedLine,
                )}
                style={{ left: lineX }}
              />
            )}

            {effectiveStatus === "idle" && (
              <motion.div
                aria-live="polite"
                className={cn(
                  "pointer-events-none absolute z-10",
                  tooltipSide === "top" ? "-top-4" : "bottom-[-1.5rem]",
                )}
                style={{ left: clampedTooltipX, x: "-50%" }}
                animate={
                  disableAnimation
                    ? { y: 0 }
                    : {
                        y: isHovering ? (tooltipSide === "top" ? -12 : 12) : 0,
                      }
                }
                transition={
                  disableAnimation ? { duration: 0 } : TOOLTIP_ENTER_SPRING
                }
              >
                <motion.div
                  key="tooltip"
                  initial={
                    disableAnimation
                      ? false
                      : { y: 10, scale: 0.94, opacity: 0 }
                  }
                  animate={{ y: 0, scale: 1, opacity: 1 }}
                  exit={{ y: 6, scale: 0.94, opacity: 0 }}
                  transition={
                    disableAnimation ? { duration: 0 } : TOOLTIP_ENTER_SPRING
                  }
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      ref={tooltipRef}
                      layout={!disableAnimation}
                      transition={
                        disableAnimation
                          ? { duration: 0 }
                          : {
                              layout: {
                                type: "spring",
                                stiffness: 420,
                                damping: 30,
                                mass: 0.52,
                              },
                            }
                      }
                      className={cn(
                        "flex flex-col gap-0.5 rounded-xl px-3 py-1.5",
                        appearance.tooltipBg,
                        appearance.tooltipShadow,
                      )}
                    >
                      {isHovering && tooltipLabel != null && (
                        <motion.span
                          key={activePoint?.dataIndex ?? defaultIndex}
                          layout={!disableAnimation}
                          initial={disableAnimation ? false : { opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={
                            disableAnimation
                              ? { duration: 0 }
                              : TOOLTIP_ENTER_SPRING
                          }
                          className={cn(
                            "text-[11px] font-medium tracking-tight uppercase",
                            appearance.tooltipSub,
                          )}
                        >
                          {tooltipLabel}
                        </motion.span>
                      )}

                      <NumberFlow
                        className={cn(
                          "text-sm font-bold",
                          appearance.tooltipText,
                        )}
                        format={tooltipFormat}
                        locales={locale}
                        prefix={resolvedTooltipPrefix}
                        value={tooltipValue}
                        willChange
                      />

                      {compareDataPoint && (
                        <NumberFlow
                          className={cn(
                            "text-[12px] font-medium",
                            appearance.tooltipSub,
                          )}
                          format={tooltipFormat}
                          locales={locale}
                          prefix="vs "
                          value={getTooltipValue(compareDataPoint)}
                          willChange
                        />
                      )}
                    </motion.div>
                  </AnimatePresence>
                </motion.div>
              </motion.div>
            )}

            <div
              className={cn(
                "relative z-[1]",
                effectiveStatus === "idle" ? "pt-8" : "pt-2",
              )}
            >
              <DotChart
                data={data}
                compare={compare}
                defaultActiveIndex={defaultIndex}
                onActivePointChange={handleActivePointChange}
                onPointerLeave={handlePointerLeave}
                sections={sections}
                idleColor={appearance.idleDot}
                hoverColor={appearance.hoverDot}
                skeletonDotColor={appearance.skeletonDot}
                showPrimaryLine={lineMode}
                showCompareLine={lineMode}
                primaryLineStroke={appearance.primaryLineStroke}
                compareLineStroke={appearance.compareLineStroke}
                compareLineFill={appearance.compareLineFill}
                status={effectiveStatus}
                disableAnimation={disableAnimation}
                ariaLabel={ariaLabel}
                {...mergedChartProps}
              />
            </div>
          </>
        )}

        {shouldShowLegend && effectiveStatus === "idle" && (
          <Legend
            sections={sections}
            appearance={appearance}
            compareLabel={compare ? compareLabel : undefined}
            currentLabel={currentLabel}
            lineMode={lineMode}
            onLineModeChange={handleLineModeChange}
            switchLabel={compareToggleLabel}
            switchId={switchId}
            showSwitch={hasCompare}
          />
        )}
      </div>
    </div>
  );
}
