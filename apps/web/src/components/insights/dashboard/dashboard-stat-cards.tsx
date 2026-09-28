"use client";

import { StatCards, type StatCardData } from "@/components/spectrumui/charts/stat-cards";
import { formatCount } from "@/lib/format";
import type { StatKind, StatSpec } from "@/lib/insights/dashboard-stats";
import { formatCompact, formatDuration, formatEur } from "@/lib/insights/dashboard-view";

const FORMATS: Record<StatKind, (value: number) => string> = {
  eur: formatEur,
  count: (value) => formatCount(Math.round(value)),
  decimal: (value) => value.toFixed(1),
  compact: formatCompact,
  percent: (value) => `${value.toFixed(1)}%`,
  ms: (value) => formatDuration(value),
};

/**
 * The Spectrum UI stat cards over `StatSpec`s: a sparkline of the daily
 * series that scrubs to each day's value on hover, and a delta against the
 * period of equal length just before this one. While the view is stale the
 * block shows its own skeleton. Shared by the Costs and Observability
 * dashboards and, `bare`, by the Assistant Overview's Activity card.
 */
export function DashboardStatCards({
  specs,
  loading = false,
  columns = 2,
  bare = false,
  deltaLabel = "vs prior period",
}: {
  specs: StatSpec[];
  loading?: boolean;
  /**
   * Two by default, the block's own default: beside the app sidebar and the
   * Insights rail a four-across card is ~215px wide and truncates its label.
   */
  columns?: 1 | 2;
  bare?: boolean;
  deltaLabel?: string;
}) {
  const cards: StatCardData[] = specs.map((spec) => ({
    label: spec.label,
    value: spec.value,
    previous: spec.previous,
    series: spec.series.length >= 2 ? spec.series : undefined,
    labels: spec.labels,
    format: FORMATS[spec.kind],
    goodWhen: spec.goodWhen,
    deltaLabel,
    caption: spec.caption,
  }));
  return <StatCards cards={cards} columns={columns} bare={bare} loading={loading} />;
}
