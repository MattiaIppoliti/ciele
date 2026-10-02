/** Shared grayscale series. CSS tokens reverse the ramp for dark surfaces. */
export const CHART_SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

/** Neutral outcomes for charts that call for the shared grayscale palette. */
export const CHART_OUTCOMES = {
  positive: "var(--chart-1)",
  negative: "var(--chart-3)",
} as const;
