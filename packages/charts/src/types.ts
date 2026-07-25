export interface DotChartDataPoint {
  value: number;
  label?: string;
}

export interface DotPalette {
  filled: string;
  active: string;
  topDot: string;
}

/**
 * A contiguous x-axis range that shares a color palette.
 * Invariants (enforced by convention, not by type):
 *   - 0 ≤ start ≤ end ≤ 1
 *   - sections should cover [0, 1] without overlapping; the resolver uses
 *     the first match and falls back to the last section for edge values
 */
export interface DotSection {
  /** Section start position along the x-axis, between 0 and 1 inclusive */
  start: number;
  /** Section end position along the x-axis, between 0 and 1 inclusive */
  end: number;
  palette: DotPalette;
  /** Optional human-readable label, surfaced by the Legend */
  label?: string;
}

export type DotChartStatus = "idle" | "loading" | "empty" | "error";
export type CardAppearance = "light" | "dark" | "pastel";
export type TrendDirection = "up" | "down" | "flat";

export interface DotChartActivePoint<
  TData extends DotChartDataPoint = DotChartDataPoint,
> {
  dataPoint: TData;
  dataIndex: number;
  columnIndex: number;
  height: number;
  x: number;
}
