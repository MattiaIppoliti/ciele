"use client";

import {
  memo,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion } from "motion/react";
import { cn } from "./cn";
import {
  buildSeriesPath,
  clamp,
  interpolateHeight,
  normalizeValues,
  resolveSectionPalette,
  skeletonHeight,
} from "./helpers";
import type {
  DotChartActivePoint,
  DotChartDataPoint,
  DotChartStatus,
  DotPalette,
  DotSection,
} from "./types";

const DOT_TRANSITION = {
  type: "spring" as const,
  stiffness: 320,
  damping: 28,
  mass: 0.45,
};

// Module-level default, must be a stable reference so it doesn't
// invalidate useMemo on every render.
const DEFAULT_FALLBACK_PALETTE: DotPalette = {
  filled: "rgba(147,197,253,0.72)",
  active: "#60a5fa",
  topDot: "#3b82f6",
};

/* ═══════════════════════════════════════════════════════════════
   DotColumn: memoized leaf renderer
   ═══════════════════════════════════════════════════════════════ */

interface DotColumnProps {
  columnIndex: number;
  rows: number;
  cellSize: number;
  dotSize: number;
  columnHeight: number;
  isActiveColumn: boolean;
  activeInfluence: number;
  colors: DotPalette;
  idleColor: string;
  hoverColor: string;
  disableAnimation: boolean;
}

const DotColumn = memo(function DotColumn({
  columnIndex,
  rows,
  cellSize,
  dotSize,
  columnHeight,
  isActiveColumn,
  activeInfluence,
  colors,
  idleColor,
  hoverColor,
  disableAnimation,
}: DotColumnProps) {
  const baseX = columnIndex * cellSize + dotSize / 2;
  const transition = disableAnimation ? { duration: 0 } : DOT_TRANSITION;
  return (
    <g>
      {Array.from({ length: rows }, (_, rowIndex) => {
        const dotRow = rows - 1 - rowIndex;
        const isFilled = dotRow < columnHeight;
        const isTopDot =
          isActiveColumn &&
          isFilled &&
          dotRow === Math.max(columnHeight - 1, 0);
        const useActiveColor = isFilled && activeInfluence > 0;

        return (
          <motion.circle
            key={rowIndex}
            cx={baseX}
            cy={rowIndex * cellSize + dotSize / 2}
            r={dotSize / 2}
            initial={false}
            animate={{
              fill: isTopDot
                ? colors.topDot
                : useActiveColor
                  ? colors.active
                  : isActiveColumn
                    ? hoverColor
                    : isFilled
                      ? colors.filled
                      : idleColor,
              opacity: isTopDot
                ? 1
                : useActiveColor
                  ? 0.2 + activeInfluence * 0.8
                  : isActiveColumn
                    ? isFilled
                      ? 1
                      : 0.45
                    : 1,
              scale: isTopDot ? 1.45 : 1,
            }}
            transition={transition}
          />
        );
      })}
    </g>
  );
});

/* ═══════════════════════════════════════════════════════════════
   SkeletonColumn: loading state leaf
   ═══════════════════════════════════════════════════════════════ */

interface SkeletonColumnProps {
  columnIndex: number;
  rows: number;
  cellSize: number;
  dotSize: number;
  columnHeight: number;
  color: string;
  disableAnimation: boolean;
}

const SkeletonColumn = memo(function SkeletonColumn({
  columnIndex,
  rows,
  cellSize,
  dotSize,
  columnHeight,
  color,
  disableAnimation,
}: SkeletonColumnProps) {
  const baseX = columnIndex * cellSize + dotSize / 2;
  return (
    <g>
      {Array.from({ length: rows }, (_, rowIndex) => {
        const dotRow = rows - 1 - rowIndex;
        const isFilled = dotRow < columnHeight;
        return (
          <motion.circle
            key={rowIndex}
            cx={baseX}
            cy={rowIndex * cellSize + dotSize / 2}
            r={dotSize / 2}
            fill={isFilled ? color : "transparent"}
            initial={{ opacity: isFilled ? 0.3 : 0 }}
            animate={
              disableAnimation
                ? { opacity: isFilled ? 0.6 : 0 }
                : {
                    opacity: isFilled ? [0.3, 0.8, 0.3] : 0,
                  }
            }
            transition={
              disableAnimation
                ? { duration: 0 }
                : {
                    duration: 1.4,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: (columnIndex % 8) * 0.08,
                  }
            }
          />
        );
      })}
    </g>
  );
});

/* ═══════════════════════════════════════════════════════════════
   DotChart: headless primitive
   ═══════════════════════════════════════════════════════════════ */

/**
 * Props for the headless {@link DotChart} primitive.
 * Consumers typically use {@link MetricGrowthCard} instead; this primitive
 * is exported for advanced composition (custom shells, dashboards, etc.).
 */
export interface DotChartProps<
  TData extends DotChartDataPoint = DotChartDataPoint,
> {
  data: readonly TData[];
  compare?: readonly TData[];
  rows?: number;
  dotSize?: number;
  gap?: number;
  fallbackPalette?: DotPalette;
  idleColor?: string;
  hoverColor?: string;
  skeletonDotColor?: string;
  /** Render the primary (current) series as a line overlay tracing each column's peak */
  showPrimaryLine?: boolean;
  /** Render the compare (previous) series as a line overlay. Ignored if `compare` is not provided */
  showCompareLine?: boolean;
  /** Stroke color for the primary (current) series line overlay */
  primaryLineStroke?: string;
  /** Stroke color for the compare (previous) series line overlay */
  compareLineStroke?: string;
  /** Fill color for the compare-series area below the line (null/undefined disables fill) */
  compareLineFill?: string;
  sections?: readonly DotSection[];
  activeColumnSpread?: number;
  className?: string;
  defaultActiveIndex?: number;
  onActivePointChange?: (point: DotChartActivePoint<TData>) => void;
  onPointerLeave?: () => void;
  status?: DotChartStatus;
  disableAnimation?: boolean;
  ariaLabel?: string;
}

function DotChartImpl<TData extends DotChartDataPoint = DotChartDataPoint>({
  data,
  compare,
  rows = 11,
  dotSize = 4,
  gap = 5,
  fallbackPalette = DEFAULT_FALLBACK_PALETTE,
  idleColor = "rgba(18,18,18,0.08)",
  hoverColor = "rgba(18,18,18,0.04)",
  skeletonDotColor = "rgba(18,18,18,0.12)",
  showPrimaryLine = false,
  showCompareLine = true,
  primaryLineStroke = "rgba(18,18,18,0.85)",
  compareLineStroke = "rgba(18,18,18,0.4)",
  compareLineFill = "rgba(18,18,18,0.06)",
  sections,
  activeColumnSpread = 4,
  className,
  defaultActiveIndex,
  onActivePointChange,
  onPointerLeave,
  status = "idle",
  disableAnimation = false,
  ariaLabel,
}: DotChartProps<TData>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [activeColumn, setActiveColumn] = useState<number | null>(null);

  const resolvedRows = Math.max(1, Math.round(rows));
  const resolvedDotSize = Math.max(1, dotSize);
  const resolvedGap = Math.max(0, gap);
  const resolvedActiveColumnSpread = Math.max(
    0,
    Math.round(activeColumnSpread),
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const cellSize = resolvedDotSize + resolvedGap;
  const columnCount =
    containerWidth > 0 ? Math.max(1, Math.floor(containerWidth / cellSize)) : 0;
  const svgWidth = Math.max(columnCount * cellSize, resolvedDotSize);
  const svgHeight = Math.max(resolvedRows * cellSize, resolvedDotSize);
  const hasData = data.length > 0;
  const effectiveStatus: DotChartStatus =
    status === "idle" && !hasData ? "empty" : status;

  // Memoize per-column computations. Intentionally excludes `activeColumn`
  // so mouse-move re-renders don't re-run this heavy work.
  const {
    columnHeights,
    columnColors,
    primaryLinePath,
    compareStrokePath,
    compareAreaPath,
  } = useMemo(() => {
    const empty = {
      columnHeights: [] as number[],
      columnColors: [] as DotPalette[],
      primaryLinePath: "",
      compareStrokePath: "",
      compareAreaPath: "",
    };

    if (columnCount === 0) return empty;

    if (effectiveStatus === "loading") {
      const heights = new Array<number>(columnCount);
      for (let i = 0; i < columnCount; i++) {
        heights[i] = skeletonHeight(i, resolvedRows);
      }
      return { ...empty, columnHeights: heights };
    }

    if (!hasData || effectiveStatus !== "idle") return empty;

    const dataValues = data.map((p) => p.value);
    const compareValues = compare ? compare.map((p) => p.value) : [];
    const maxValue = Math.max(0, ...dataValues, ...compareValues);
    const normalized = normalizeValues(dataValues, maxValue, resolvedRows);
    const normalizedCompare = compare
      ? normalizeValues(compareValues, maxValue, resolvedRows)
      : [];

    const heights = new Array<number>(columnCount);
    const palettes = new Array<DotPalette>(columnCount);
    const compareH: number[] = compare ? new Array<number>(columnCount) : [];

    for (let i = 0; i < columnCount; i++) {
      heights[i] = interpolateHeight(i, columnCount, normalized);
      palettes[i] = resolveSectionPalette(
        i,
        columnCount,
        sections,
        fallbackPalette,
      );
      if (compare) {
        compareH[i] = interpolateHeight(i, columnCount, normalizedCompare);
      }
    }

    const pathArgs = [
      resolvedRows,
      cellSize,
      resolvedDotSize,
      svgHeight,
    ] as const;
    return {
      columnHeights: heights,
      columnColors: palettes,
      primaryLinePath:
        heights.length > 1
          ? buildSeriesPath(heights, ...pathArgs, "stroke")
          : "",
      compareStrokePath:
        compareH.length > 1
          ? buildSeriesPath(compareH, ...pathArgs, "stroke")
          : "",
      compareAreaPath:
        compareH.length > 1
          ? buildSeriesPath(compareH, ...pathArgs, "area")
          : "",
    };
  }, [
    effectiveStatus,
    hasData,
    columnCount,
    data,
    compare,
    resolvedRows,
    sections,
    fallbackPalette,
    cellSize,
    resolvedDotSize,
    svgHeight,
  ]);

  const resolveColumnIndex = useCallback(
    (dataIndex: number) => {
      if (columnCount <= 1 || data.length <= 1) return 0;
      return Math.round(
        (clamp(dataIndex, 0, data.length - 1) / (data.length - 1)) *
          (columnCount - 1),
      );
    },
    [columnCount, data.length],
  );

  const resolveDataIndex = useCallback(
    (columnIndex: number) => {
      if (columnCount <= 1 || data.length <= 1) return 0;
      return Math.round(
        (clamp(columnIndex, 0, columnCount - 1) / (columnCount - 1)) *
          (data.length - 1),
      );
    },
    [columnCount, data.length],
  );

  useLayoutEffect(() => {
    if (effectiveStatus !== "idle" || columnCount === 0) return;
    setActiveColumn((currentColumn) => {
      if (currentColumn !== null) {
        return clamp(currentColumn, 0, columnCount - 1);
      }
      return resolveColumnIndex(defaultActiveIndex ?? data.length - 1);
    });
  }, [
    columnCount,
    defaultActiveIndex,
    effectiveStatus,
    data.length,
    resolveColumnIndex,
  ]);

  useLayoutEffect(() => {
    if (
      effectiveStatus !== "idle" ||
      columnCount === 0 ||
      activeColumn === null ||
      !onActivePointChange
    ) {
      return;
    }
    const dataIndex = resolveDataIndex(activeColumn);
    const dataPoint = data[dataIndex];
    if (!dataPoint) return;
    onActivePointChange({
      dataPoint,
      dataIndex,
      columnIndex: activeColumn,
      height: columnHeights[activeColumn] ?? 0,
      x: activeColumn * cellSize + cellSize / 2,
    });
  }, [
    activeColumn,
    cellSize,
    columnCount,
    columnHeights,
    data,
    effectiveStatus,
    onActivePointChange,
    resolveDataIndex,
  ]);

  const handlePointerMove = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      if (effectiveStatus !== "idle" || columnCount === 0) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const nextColumn = clamp(
        Math.floor((event.clientX - bounds.left) / cellSize),
        0,
        columnCount - 1,
      );
      setActiveColumn((prev) => (prev === nextColumn ? prev : nextColumn));
    },
    [cellSize, columnCount, effectiveStatus],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<SVGSVGElement>) => {
      if (effectiveStatus !== "idle" || columnCount === 0) return;
      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          setActiveColumn((prev) =>
            prev === null ? columnCount - 1 : Math.max(0, prev - 1),
          );
          break;
        case "ArrowRight":
          event.preventDefault();
          setActiveColumn((prev) =>
            prev === null ? 0 : Math.min(columnCount - 1, prev + 1),
          );
          break;
        case "Home":
          event.preventDefault();
          setActiveColumn(0);
          break;
        case "End":
          event.preventDefault();
          setActiveColumn(columnCount - 1);
          break;
        default:
          break;
      }
    },
    [columnCount, effectiveStatus],
  );

  const descriptiveLabel =
    ariaLabel ??
    (hasData
      ? `Dot matrix chart with ${data.length} data points`
      : "Dot matrix chart");

  return (
    <div ref={containerRef} className={cn("w-full", className)}>
      {columnCount > 0 ? (
        <svg
          role="img"
          aria-label={descriptiveLabel}
          tabIndex={effectiveStatus === "idle" ? 0 : -1}
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          onPointerMove={handlePointerMove}
          onPointerLeave={onPointerLeave}
          onKeyDown={handleKeyDown}
          style={{
            cursor: effectiveStatus === "idle" ? "crosshair" : "default",
            display: "block",
            width: "100%",
          }}
          className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {effectiveStatus === "loading" &&
            columnHeights.map((h, i) => (
              <SkeletonColumn
                key={i}
                columnIndex={i}
                rows={resolvedRows}
                cellSize={cellSize}
                dotSize={resolvedDotSize}
                columnHeight={h}
                color={skeletonDotColor}
                disableAnimation={disableAnimation}
              />
            ))}

          {/* Compare (previous) series, rendered BEFORE data so dots sit on
              top. Previous is visually secondary, so a lighter stroke + area
              fill are fine under the dots. */}
          {effectiveStatus === "idle" &&
            showCompareLine &&
            compareStrokePath && (
              <g aria-hidden>
                {compareLineFill && (
                  <path
                    d={compareAreaPath}
                    fill={compareLineFill}
                    stroke="none"
                  />
                )}
                <path
                  d={compareStrokePath}
                  fill="none"
                  stroke={compareLineStroke}
                  strokeWidth={1.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            )}

          {effectiveStatus === "idle" &&
            columnHeights.map((columnHeight, columnIndex) => {
              const distance =
                activeColumn === null
                  ? resolvedActiveColumnSpread + 1
                  : Math.abs(activeColumn - columnIndex);
              const activeInfluence =
                distance > resolvedActiveColumnSpread
                  ? 0
                  : 1 - distance / (resolvedActiveColumnSpread + 1);

              return (
                <DotColumn
                  key={columnIndex}
                  columnIndex={columnIndex}
                  rows={resolvedRows}
                  cellSize={cellSize}
                  dotSize={resolvedDotSize}
                  columnHeight={columnHeight}
                  isActiveColumn={activeColumn === columnIndex}
                  activeInfluence={activeInfluence}
                  colors={columnColors[columnIndex]}
                  idleColor={idleColor}
                  hoverColor={hoverColor}
                  disableAnimation={disableAnimation}
                />
              );
            })}

          {/* Primary (current) series line, rendered AFTER dots so the line
              sits on top. This is the "bold" line in compare view; stroke is
              thicker than the compare line to establish visual hierarchy. */}
          {effectiveStatus === "idle" && showPrimaryLine && primaryLinePath && (
            <path
              aria-hidden
              d={primaryLinePath}
              fill="none"
              stroke={primaryLineStroke}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
      ) : null}
    </div>
  );
}

/**
 * Headless dot-matrix chart primitive. Renders a grid of animated SVG
 * circles representing the normalized heights of each data point.
 *
 * Performance: wrapped in `memo` so the parent card re-rendering (e.g. from
 * `setActivePoint`) does not trigger a second DotChart render per tick. Each
 * column is further `memo`ed via `DotColumn`; moving the active column only
 * re-renders the ~10 columns within `activeColumnSpread`.
 *
 * Accessibility: the SVG is focusable and accepts ArrowLeft/ArrowRight/
 * Home/End for keyboard navigation. Status transitions disable interactions.
 */
export const DotChart = memo(DotChartImpl) as typeof DotChartImpl;
