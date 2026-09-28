export interface DotChartDataPoint {
  value: number;
  label?: string;
}

export type DotChartStatus = "idle" | "empty";
export type TrendDirection = "up" | "down" | "flat";

export interface DotChartActivePoint {
  dataPoint: DotChartDataPoint;
  dataIndex: number;
  columnIndex: number;
  height: number;
  x: number;
}
