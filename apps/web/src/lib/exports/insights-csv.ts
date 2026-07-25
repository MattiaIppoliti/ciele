import type { InsightsOverview } from "@/lib/insights/report";

function escapeCsv(value: unknown): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

/**
 * Renders an Insights Overview as the same per-day, per-series CSV the
 * in-browser Export button produces, so the async artifact matches what an
 * admin already recognizes. The header is the date column plus one column per
 * chart series; each row is a bucket label.
 */
export function insightsOverviewToCsv(overview: InsightsOverview): string {
  const { labels, series } = overview.chart;
  const headers = ["date", ...series.map((s) => s.key)];
  const rows = labels.map((label, index) => [
    label,
    ...series.map((s) => s.values[index] ?? 0),
  ]);
  return [
    headers.map(escapeCsv).join(","),
    ...rows.map((row) => row.map(escapeCsv).join(",")),
  ].join("\n");
}
