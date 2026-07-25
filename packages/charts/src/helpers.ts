import type { DotChartDataPoint, DotPalette, DotSection } from "./types";

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function resolveSectionPalette(
  columnIndex: number,
  columnCount: number,
  sections: readonly DotSection[] | undefined,
  fallback: DotPalette,
): DotPalette {
  if (!sections || sections.length === 0 || columnCount <= 0) return fallback;
  const position = columnCount > 1 ? columnIndex / (columnCount - 1) : 0;
  const match =
    sections.find((s) => position >= s.start && position <= s.end) ??
    sections[sections.length - 1];
  return match.palette;
}

export function normalizeValues(
  values: readonly number[],
  maxValue: number,
  rows: number,
): number[] {
  return values.map((v) =>
    maxValue === 0 ? 0 : Math.round((v / maxValue) * rows),
  );
}

export function interpolateHeight(
  columnIndex: number,
  columnCount: number,
  normalized: readonly number[],
): number {
  const dataLength = normalized.length;
  if (columnCount <= 1 || dataLength <= 1) return normalized[0] ?? 0;
  const rawIndex = (columnIndex / (columnCount - 1)) * (dataLength - 1);
  const lowerIndex = Math.floor(rawIndex);
  const upperIndex = Math.min(dataLength - 1, Math.ceil(rawIndex));
  const interp = rawIndex - lowerIndex;
  return Math.round(
    (normalized[lowerIndex] ?? 0) * (1 - interp) +
      (normalized[upperIndex] ?? 0) * interp,
  );
}

export function skeletonHeight(columnIndex: number, rows: number): number {
  const rand = Math.sin(columnIndex * 12.9898) * 43758.5453;
  const frac = rand - Math.floor(rand);
  return Math.round(frac * rows * 0.6 + rows * 0.2);
}

/**
 * Build an SVG path string tracing the top of each column of a series.
 *
 * - "stroke" variant: quadratic-smoothed polyline for the visible line
 * - "area" variant: same polyline closed down to the x-axis, suitable for
 *   a fill underneath the line.
 *
 * Quadratic smoothing via midpoints produces a softer curve that reads less
 * like a "chart line" and more like a trend envelope.
 */
export function buildSeriesPath(
  heights: readonly number[],
  rows: number,
  cellSize: number,
  dotSize: number,
  svgHeight: number,
  variant: "stroke" | "area",
): string {
  if (heights.length < 2) return "";
  const points: Array<[number, number]> = heights.map((h, i) => {
    const x = i * cellSize + dotSize / 2;
    const y = (rows - Math.max(h, 0)) * cellSize + dotSize / 2;
    return [x, y];
  });

  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const midX = (px + cx) / 2;
    const midY = (py + cy) / 2;
    d += ` Q ${px} ${py} ${midX} ${midY}`;
  }
  const [lastX, lastY] = points[points.length - 1];
  d += ` L ${lastX} ${lastY}`;

  if (variant === "area") {
    d += ` L ${lastX} ${svgHeight} L ${points[0][0]} ${svgHeight} Z`;
  }
  return d;
}

export interface DailyPoint {
  /** ISO day, e.g. "2026-07-01" */
  day: string;
  value: number;
}

/**
 * Zero-fill a sparse day-keyed series into a dense window of `days` entries
 * ending at `end` (inclusive). Points outside the window are dropped.
 * Output is sorted ascending by day, one entry per calendar day (UTC).
 */
export function toDenseDailySeries(
  points: readonly DailyPoint[],
  days: number,
  end: Date,
): DailyPoint[] {
  const byDay = new Map<string, number>();
  for (const p of points) {
    byDay.set(p.day, (byDay.get(p.day) ?? 0) + p.value);
  }
  const endUtc = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate(),
  );
  const out: DailyPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(endUtc - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ day, value: byDay.get(day) ?? 0 });
  }
  return out;
}

/** Sum of a dot-chart series' values. */
export function seriesTotal(points: readonly DotChartDataPoint[]): number {
  return points.reduce((acc, p) => acc + p.value, 0);
}

/**
 * Percent change from `previous` to `current`, rounded to one decimal.
 * Returns null when there is no meaningful baseline (previous === 0).
 */
export function percentChange(
  current: number,
  previous: number,
): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
