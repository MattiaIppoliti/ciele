export type BrushChartBucket = "day" | "week" | "month";

/** One tooltip's change and captions, using the same bucket interval. */
export function brushComparison(
  points: readonly { value: number }[],
  index: number | null,
  bucket: BrushChartBucket = "day",
) {
  const reading = index === null ? undefined : points[index];
  const offset = bucket === "day" ? 7 : 1;
  const previous = index !== null && index >= offset ? points[index - offset] : undefined;
  return {
    change: reading && previous && previous.value
      ? (reading.value - previous.value) / previous.value
      : null,
    comparisonLabel: bucket === "month" ? "vs a month earlier" : "vs a week earlier",
    averageLabel: `7-${bucket} average`,
  };
}
