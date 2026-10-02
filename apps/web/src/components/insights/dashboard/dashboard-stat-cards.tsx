"use client";

import { ArcFrame } from "@/components/charts/arc/arc-frame";
import { MetricCard } from "@/components/charts/arc/metric-card/metric-card";
import { Sparkline } from "@/components/charts/arc/sparkline/sparkline";
import { formatCount } from "@/lib/format";
import type { StatKind, StatSpec } from "@/lib/insights/dashboard-stats";
import { formatCompact, formatDuration, formatEur } from "@/lib/insights/dashboard-view";

const FORMATS: Record<StatKind, (value: number) => string> = {
  eur: formatEur, count: (value) => formatCount(Math.round(value)), decimal: (value) => value.toFixed(1),
  compact: formatCompact, percent: (value) => `${value.toFixed(1)}%`, ms: formatDuration,
};

export function DashboardStatCards({ specs, loading = false, columns = 2, bare = false, deltaLabel = "vs prior period" }: {
  specs: StatSpec[]; loading?: boolean; columns?: 1 | 2; bare?: boolean; deltaLabel?: string;
}) {
  return <ArcFrame className={`grid gap-4 ${columns === 2 ? "@xl:grid-cols-2" : "grid-cols-1"}`}>
    {specs.map((spec) => {
      if (loading) return <div key={spec.key} aria-label={`Loading ${spec.label}`} className="h-48 animate-pulse rounded-xl bg-muted/40" />;
      const missing = spec.caption === "No finished turns";
      const change = spec.previous === null || spec.previous === 0 ? undefined : (spec.value - spec.previous) / spec.previous * 100;
      const changeText = change === undefined ? undefined : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
      const decimals = spec.kind === "eur" ? (spec.value < 1 ? 4 : 2) : spec.kind === "decimal" || spec.kind === "percent" ? 1 : spec.kind === "ms" && spec.value >= 1000 ? 2 : 0;
      const displayValue = spec.kind === "ms" && spec.value >= 1000 ? spec.value / 1000 : spec.value;
      const suffix = spec.kind === "percent" ? "%" : spec.kind === "ms" ? spec.value >= 1000 ? " s" : " ms" : undefined;
      const tone = change === undefined || change === 0 || spec.goodWhen === "neutral" ? "accent" : (change >= 0) === (spec.goodWhen === "up") ? "success" : "danger";
      return <div key={spec.key} data-change-tone={tone} className={`arc-stat-card min-w-0 overflow-hidden rounded-xl ${bare ? "" : "border bg-card"}`}>
        {missing ? <div className="p-4"><p className="text-sm text-muted-foreground">{spec.label}</p><p className="mt-4 text-3xl">—</p><p className="mt-3 text-xs text-muted-foreground">{spec.caption}</p></div>
          : <MetricCard label={spec.label} value={displayValue} decimals={decimals} prefix={spec.kind === "eur" ? "€" : undefined} suffix={suffix}
            context={changeText ? deltaLabel : spec.caption} change={changeText} />}
        {!missing && spec.series.length >= 2 && <div className="px-4 pb-4"><Sparkline data={spec.series} labels={spec.labels}
          label="Daily trend" value={FORMATS[spec.kind](spec.value)} formatValue={FORMATS[spec.kind]} tone={tone} width={600} height={44} /></div>}
      </div>;
    })}
  </ArcFrame>;
}
