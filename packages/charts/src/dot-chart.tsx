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
import { APPEARANCE } from "./appearances";
import {
  buildSeriesPath,
  clamp,
  interpolateHeight,
  normalizeValues,
} from "./helpers";
import type {
  DotChartActivePoint,
  DotChartDataPoint,
  DotChartStatus,
} from "./types";

const DOT_TRANSITION = {
  type: "spring" as const,
  stiffness: 320,
  damping: 28,
  mass: 0.45,
};

/** Grid geometry shared with MetricGrowthCard's tooltip positioning. */
export const DOT_ROWS = 14;
export const DOT_SIZE = 4;
export const DOT_GAP = 5;
export const DOT_CELL_SIZE = DOT_SIZE + DOT_GAP;
const SVG_HEIGHT = Math.max(DOT_ROWS * DOT_CELL_SIZE, DOT_SIZE);

const ACTIVE_COLUMN_SPREAD = 4;

/** Dot colors: the ciele brand-navy used across both consoles. */
const PALETTE = {
  filled: "rgba(38,46,92,0.55)",
  active: "#3c477e",
  topDot: "#1d2450",
};

/* ═══════════════════════════════════════════════════════════════
   DotColumn: memoized leaf renderer
   ═══════════════════════════════════════════════════════════════ */

interface DotColumnProps {
  columnIndex: number;
  columnHeight: number;
  isActiveColumn: boolean;
  activeInfluence: number;
  disableAnimation: boolean;
}

const DotColumn = memo(function DotColumn({
  columnIndex,
  columnHeight,
  isActiveColumn,
  activeInfluence,
  disableAnimation,
}: DotColumnProps) {
  const baseX = columnIndex * DOT_CELL_SIZE + DOT_SIZE / 2;
  const transition = disableAnimation ? { duration: 0 } : DOT_TRANSITION;
  return (
    <g>
      {Array.from({ length: DOT_ROWS }, (_, rowIndex) => {
        const dotRow = DOT_ROWS - 1 - rowIndex;
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
            cy={rowIndex * DOT_CELL_SIZE + DOT_SIZE / 2}
            r={DOT_SIZE / 2}
            initial={false}
            animate={{
              fill: isTopDot
                ? PALETTE.topDot
                : useActiveColor
                  ? PALETTE.active
                  : isActiveColumn
                    ? APPEARANCE.hoverDot
                    : isFilled
                      ? PALETTE.filled
                      : APPEARANCE.idleDot,
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
   DotChart: headless primitive
   ═══════════════════════════════════════════════════════════════ */

/** Props for the internal {@link DotChart} primitive. */
export interface DotChartProps {
  data: readonly DotChartDataPoint[];
  compare?: readonly DotChartDataPoint[];
  /**
   * Render both series as line overlays tracing each column's peak: the
   * primary (current) one and, when `compare` is provided, the previous one.
   */
  showLines: boolean;
  defaultActiveIndex?: number;
  onActivePointChange?: (point: DotChartActivePoint) => void;
  onPointerLeave?: () => void;
  disableAnimation?: boolean;
  ariaLabel?: string;
}

function DotChartImpl({
  data,
  compare,
  showLines,
  defaultActiveIndex,
  onActivePointChange,
  onPointerLeave,
  disableAnimation = false,
  ariaLabel,
}: DotChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [activeColumn, setActiveColumn] = useState<number | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const columnCount =
    containerWidth > 0
      ? Math.max(1, Math.floor(containerWidth / DOT_CELL_SIZE))
      : 0;
  const svgWidth = Math.max(columnCount * DOT_CELL_SIZE, DOT_SIZE);
  const hasData = data.length > 0;
  const effectiveStatus: DotChartStatus = hasData ? "idle" : "empty";

  // Memoize per-column computations. Intentionally excludes `activeColumn`
  // so mouse-move re-renders don't re-run this heavy work.
  const {
    columnHeights,
    primaryLinePath,
    compareStrokePath,
    compareAreaPath,
  } = useMemo(() => {
    const empty = {
      columnHeights: [] as number[],
      primaryLinePath: "",
      compareStrokePath: "",
      compareAreaPath: "",
    };

    if (columnCount === 0) return empty;
    if (!hasData || effectiveStatus !== "idle") return empty;

    const dataValues = data.map((p) => p.value);
    const compareValues = compare ? compare.map((p) => p.value) : [];
    const maxValue = Math.max(0, ...dataValues, ...compareValues);
    const normalized = normalizeValues(dataValues, maxValue, DOT_ROWS);
    const normalizedCompare = compare
      ? normalizeValues(compareValues, maxValue, DOT_ROWS)
      : [];

    const heights = new Array<number>(columnCount);
    const compareH: number[] = compare ? new Array<number>(columnCount) : [];

    for (let i = 0; i < columnCount; i++) {
      heights[i] = interpolateHeight(i, columnCount, normalized);
      if (compare) {
        compareH[i] = interpolateHeight(i, columnCount, normalizedCompare);
      }
    }

    const pathArgs = [DOT_ROWS, DOT_CELL_SIZE, DOT_SIZE, SVG_HEIGHT] as const;
    return {
      columnHeights: heights,
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
  }, [effectiveStatus, hasData, columnCount, data, compare]);

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
      x: activeColumn * DOT_CELL_SIZE + DOT_CELL_SIZE / 2,
    });
  }, [
    activeColumn,
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
        Math.floor((event.clientX - bounds.left) / DOT_CELL_SIZE),
        0,
        columnCount - 1,
      );
      setActiveColumn((prev) => (prev === nextColumn ? prev : nextColumn));
    },
    [columnCount, effectiveStatus],
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
    <div ref={containerRef} className="w-full">
      {columnCount > 0 ? (
        <svg
          role="img"
          aria-label={descriptiveLabel}
          tabIndex={effectiveStatus === "idle" ? 0 : -1}
          width={svgWidth}
          height={SVG_HEIGHT}
          viewBox={`0 0 ${svgWidth} ${SVG_HEIGHT}`}
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
          {/* Compare (previous) series, rendered BEFORE data so dots sit on
              top. Previous is visually secondary, so a lighter stroke + area
              fill are fine under the dots. */}
          {effectiveStatus === "idle" &&
            showLines &&
            compareStrokePath && (
              <g aria-hidden>
                <path
                  d={compareAreaPath}
                  fill={APPEARANCE.compareLineFill}
                  stroke="none"
                />
                <path
                  d={compareStrokePath}
                  fill="none"
                  stroke={APPEARANCE.compareLineStroke}
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
                  ? ACTIVE_COLUMN_SPREAD + 1
                  : Math.abs(activeColumn - columnIndex);
              const activeInfluence =
                distance > ACTIVE_COLUMN_SPREAD
                  ? 0
                  : 1 - distance / (ACTIVE_COLUMN_SPREAD + 1);

              return (
                <DotColumn
                  key={columnIndex}
                  columnIndex={columnIndex}
                  columnHeight={columnHeight}
                  isActiveColumn={activeColumn === columnIndex}
                  activeInfluence={activeInfluence}
                  disableAnimation={disableAnimation}
                />
              );
            })}

          {/* Primary (current) series line, rendered AFTER dots so the line
              sits on top. This is the "bold" line in compare view; stroke is
              thicker than the compare line to establish visual hierarchy. */}
          {effectiveStatus === "idle" && showLines && primaryLinePath && (
            <path
              aria-hidden
              d={primaryLinePath}
              fill="none"
              stroke={APPEARANCE.primaryLineStroke}
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
 * Headless dot-matrix chart primitive rendered by {@link MetricGrowthCard}.
 *
 * Performance: wrapped in `memo` so the parent card re-rendering (e.g. from
 * `setActivePoint`) does not trigger a second DotChart render per tick. Each
 * column is further `memo`ed via `DotColumn`; moving the active column only
 * re-renders the ~10 columns within the active-column spread.
 *
 * Accessibility: the SVG is focusable and accepts ArrowLeft/ArrowRight/
 * Home/End for keyboard navigation. Status transitions disable interactions.
 */
export const DotChart = memo(DotChartImpl);
