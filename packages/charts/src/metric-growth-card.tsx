"use client";

import NumberFlow from "@number-flow/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
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
import { BarChart3, LineChart, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@agent-hub/ui";
import { APPEARANCE, type AppearanceTokens } from "./appearances";
import { DOT_CELL_SIZE, DotChart } from "./dot-chart";
import { clamp } from "./helpers";
import type {
  DotChartActivePoint,
  DotChartDataPoint,
  DotChartStatus,
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
const TOOLTIP_FORMAT = { maximumFractionDigits: 0 } as const;

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
}

function Switch({
  checked,
  onCheckedChange,
  id,
  ariaLabel,
  trackOffClass,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-[2px]",
        "transition-colors duration-200 ease-out",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#34c759]",
        "active:scale-[0.97]",
        checked ? "bg-[#34c759]" : trackOffClass,
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
   Empty state
   ═══════════════════════════════════════════════════════════════ */

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

/* ═══════════════════════════════════════════════════════════════
   Legend
   ═══════════════════════════════════════════════════════════════ */

interface LegendProps {
  appearance: AppearanceTokens;
  compareLabel?: string;
  currentLabel?: string;
  lineMode: boolean;
  onLineModeChange: (next: boolean) => void;
  switchId: string;
}

function Legend({
  appearance,
  compareLabel,
  currentLabel,
  lineMode,
  onLineModeChange,
  switchId,
}: LegendProps) {
  const showCurrentEntry = lineMode && Boolean(currentLabel);
  const showCompareEntry = lineMode && Boolean(compareLabel);

  return (
    <div
      className={cn(
        "flex items-start justify-between gap-x-4 pt-3 text-[12px] font-medium",
        appearance.subtext,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5">
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
        {!showCurrentEntry && !showCompareEntry && (
          <span className="invisible">placeholder</span>
        )}
      </div>

      <label
        htmlFor={switchId}
        className="flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap select-none"
      >
        <span>Compare</span>
        <Switch
          id={switchId}
          checked={lineMode}
          onCheckedChange={onLineModeChange}
          ariaLabel="Toggle compare overlay"
          trackOffClass={appearance.switchTrackOff}
        />
      </label>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MetricGrowthCard: styled composition
   ═══════════════════════════════════════════════════════════════ */

const VIEWPORT_PADDING = 12;

/**
 * KPI growth card built on the DotChart primitive: header with icon, title,
 * headline value and trend pill; dot-matrix chart with crosshair + floating
 * animated-number tooltip; legend with a compare-mode switch that overlays
 * current/previous trend lines.
 *
 * @param props.data - primary time series to visualize.
 * @param props.compare - optional comparison series rendered as line overlay.
 * @param props.status - "idle" | "empty". Defaults from `data.length`.
 * @param props.trendDirection - colors the trend pill ("up" green, "down" red, "flat" muted).
 */
export interface MetricGrowthCardProps {
  data: readonly DotChartDataPoint[];
  compare?: readonly DotChartDataPoint[];
  status?: DotChartStatus;
  title?: ReactNode;
  value?: ReactNode;
  trendValue?: ReactNode;
  trendLabel?: ReactNode;
  trendDirection?: TrendDirection;
  compareLabel?: string;
  currentLabel?: string;
  ariaLabel?: string;
}

export function MetricGrowthCard({
  data,
  compare,
  status: statusProp,
  title = "Growth",
  value,
  trendValue,
  trendLabel,
  trendDirection = "up",
  compareLabel = "Previous",
  currentLabel = "Current",
  ariaLabel,
}: MetricGrowthCardProps) {
  const [lineMode, setLineMode] = useState(false);
  const switchId = useId();
  const appearance = APPEARANCE;
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
  const [activePoint, setActivePoint] = useState<DotChartActivePoint | null>(
    null,
  );

  const handleActivePointChange = useCallback(
    (point: DotChartActivePoint) => {
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
    },
    [],
  );

  const handlePointerLeave = useCallback(() => {
    setIsHovering(false);
  }, []);

  const defaultIndex = clamp(
    Math.max(data.length - 2, 0),
    0,
    Math.max(data.length - 1, 0),
  );

  const visibleDataPoint = activePoint?.dataPoint ?? data[defaultIndex] ?? null;
  const tooltipValue = visibleDataPoint?.value ?? 0;
  const tooltipLabel = visibleDataPoint?.label ?? null;

  const compareIndex = activePoint?.dataIndex ?? defaultIndex;
  const compareDataPoint =
    compare && visibleDataPoint
      ? (compare[Math.min(compareIndex, compare.length - 1)] ?? null)
      : null;

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
    const cols = Math.max(1, Math.floor(chartWidth / DOT_CELL_SIZE));
    const col =
      cols <= 1 || data.length <= 1
        ? 0
        : Math.round((defaultIndex / (data.length - 1)) * (cols - 1));
    anchorX.set(col * DOT_CELL_SIZE + DOT_CELL_SIZE / 2);
  }, [activePoint, anchorX, chartWidth, data.length, defaultIndex]);

  useEffect(() => {
    if (effectiveStatus !== "idle") {
      setActivePoint(null);
    }
  }, [effectiveStatus]);

  // Legend renders when compare data is present (it hosts the line toggle).
  const hasCompare = Boolean(compare);

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
            <BarChart3 className={cn("h-5 w-5", appearance.iconFg)} />
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
                  <span className="text-xs font-semibold">{trendValue}</span>
                </div>
              )}
              {trendLabel != null && (
                <span className={cn("truncate text-xs", appearance.subtext)}>
                  {trendLabel}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div ref={chartRef} className="relative">
        {effectiveStatus === "empty" && <EmptyState appearance={appearance} />}

        {effectiveStatus === "idle" && (
          <>
            <motion.div
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-y-0 z-0 w-px border-l border-dashed",
                appearance.dashedLine,
              )}
              style={{ left: lineX }}
            />

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
                  disableAnimation ? false : { y: 10, scale: 0.94, opacity: 0 }
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
                      className={cn("text-sm font-bold", appearance.tooltipText)}
                      format={TOOLTIP_FORMAT}
                      locales="en-US"
                      value={tooltipValue}
                      willChange
                    />

                    {compareDataPoint && (
                      <NumberFlow
                        className={cn(
                          "text-[12px] font-medium",
                          appearance.tooltipSub,
                        )}
                        format={TOOLTIP_FORMAT}
                        locales="en-US"
                        prefix="vs "
                        value={compareDataPoint.value}
                        willChange
                      />
                    )}
                  </motion.div>
                </AnimatePresence>
              </motion.div>
            </motion.div>

            <div className="relative z-[1] pt-8">
              <DotChart
                data={data}
                compare={compare}
                defaultActiveIndex={defaultIndex}
                onActivePointChange={handleActivePointChange}
                onPointerLeave={handlePointerLeave}
                idleColor={appearance.idleDot}
                hoverColor={appearance.hoverDot}
                showPrimaryLine={lineMode}
                showCompareLine={lineMode}
                primaryLineStroke={appearance.primaryLineStroke}
                compareLineStroke={appearance.compareLineStroke}
                compareLineFill={appearance.compareLineFill}
                status={effectiveStatus}
                disableAnimation={disableAnimation}
                ariaLabel={ariaLabel}
              />
            </div>
          </>
        )}

        {hasCompare && effectiveStatus === "idle" && (
          <Legend
            appearance={appearance}
            compareLabel={compareLabel}
            currentLabel={currentLabel}
            lineMode={lineMode}
            onLineModeChange={setLineMode}
            switchId={switchId}
          />
        )}
      </div>
    </div>
  );
}
