"use client";

import dynamic from "next/dynamic";
import type { UsageDashboard, DashboardSurface } from "@agent-hub/core";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCount, formatPercent, formatShortDay } from "@/lib/format";
import { formatCompact, formatDuration, formatEur, tokenHighlights } from "@/lib/insights/dashboard-view";
import { Section, SpendBars, StageBars, SurfaceComposition, TokenHeatCalendar, ModelSpendTree, LatencyHistogram, LatencyTrend, RateComparison, FlowBumpChart } from "./dashboard-kit";
import { SURFACE_COLORS, SURFACE_LABELS } from "./palette";

const UsageGauge = dynamic(() => import("@/components/usage-gauge").then((module) => module.UsageGauge), {
  ssr: false,
  loading: () => <div aria-label="Loading token share" className="size-28 shrink-0 animate-pulse rounded-full bg-muted/40 motion-reduce:animate-none" />,
});

export function SpendTrendCard({ daily, surface = "" }: { daily: UsageDashboard["daily"]; surface?: DashboardSurface | "" }) {
  return <Section title="Estimated spend per day" description={surface ? `${SURFACE_LABELS[surface]} only` : "Total estimated spend across all surfaces"}><SpendBars daily={daily} surface={surface} /></Section>;
}

export function TokenActivityCard({ daily, totals }: { daily: UsageDashboard["daily"]; totals: Pick<UsageDashboard["totals"], "inputTokens" | "outputTokens"> }) {
  const highlights = tokenHighlights(daily);
  const totalTokens = totals.inputTokens + totals.outputTokens;
  return <Section title="Token usage" description="Input and output tokens per UTC day. Hover or use arrow keys to inspect a day.">
    <div className="mb-5 flex flex-wrap items-center gap-5 border-b pb-5">
      <UsageGauge rings={[{ fraction: totalTokens ? totals.inputTokens / totalTokens : null, label: `Input tokens: ${formatCount(totals.inputTokens)} / ${formatCount(totalTokens)} total tokens` }]} valueLabel={totalTokens ? `${Math.round((totals.inputTokens / totalTokens) * 100)}%` : "—"} size={112} variant="dial" />
      <dl className="space-y-2 text-sm">
        <div><dt className="text-muted-foreground text-xs">Input tokens · share of total</dt><dd className="font-medium tabular-nums">{formatCount(totals.inputTokens)}</dd></div>
        <div><dt className="text-muted-foreground text-xs">Output tokens</dt><dd className="font-medium tabular-nums">{formatCount(totals.outputTokens)}</dd></div>
      </dl>
      {!totalTokens && <p className="text-muted-foreground text-xs">No token usage in this range.</p>}
    </div>
    <div className="overflow-x-auto"><TokenHeatCalendar daily={daily} /></div>
    <dl className="mt-6 grid grid-cols-3 gap-4 border-t pt-4 text-sm">
      <div><dt className="text-xs text-muted-foreground">Busiest day</dt><dd className="font-medium tabular-nums">{highlights.peakDay ? `${formatShortDay(highlights.peakDay)} · ${formatCompact(highlights.peakTokens)}` : "—"}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Daily average</dt><dd className="font-medium tabular-nums">{formatCompact(highlights.averageTokens)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Busiest weekday</dt><dd className="font-medium">{highlights.busiestWeekday ?? "—"}</dd></div>
    </dl>
  </Section>;
}

export function SurfaceSpendCard({ daily, surfaces, surface = "" }: { daily: UsageDashboard["daily"]; surfaces: UsageDashboard["surfaces"]; surface?: DashboardSurface | "" }) {
  const spend = surfaces.reduce((sum, row) => sum + row.spendEur, 0);
  return <Section title="Spend mix over time" description={surface ? `Daily amounts for ${SURFACE_LABELS[surface]}; totals below compare all surfaces` : "Daily estimated amounts by surface; thicker bands mean more spend"}>
    <SurfaceComposition daily={daily} />
    <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-sm @md:grid-cols-4">{surfaces.map((row) => <div key={row.surface} className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: SURFACE_COLORS[row.surface] }} />{SURFACE_LABELS[row.surface]}</dt>
      <dd className="font-medium tabular-nums">{formatEur(row.spendEur)} <span className="font-normal text-muted-foreground">· {formatPercent(Math.round((spend > 0 ? row.spendEur / spend : 0) * 100))}</span></dd>
      <dd className="truncate text-xs tabular-nums text-muted-foreground">{formatCount(row.calls)} calls · {formatCompact(row.tokens)} tokens</dd>
    </div>)}</dl>
  </Section>;
}

export function ModelSpendCard({ models }: { models: UsageDashboard["models"] }) {
  return <Section title="Spend by provider and model" description="Tile area represents estimated spend. Select a provider to inspect its models."><ModelSpendTree models={models} /></Section>;
}

export function ModelUsageCard({ models }: { models: UsageDashboard["models"] }) {
  return <Section title="Models" description="Every model that ran in this range, by estimated spend">
    {!models.length ? <p className="py-6 text-sm text-muted-foreground">No model calls in this range.</p> : <div className="overflow-x-auto"><Table>
      <TableHeader><TableRow><TableHead>Model</TableHead><TableHead>Provider</TableHead><TableHead className="text-right">Estimated spend</TableHead><TableHead className="text-right">Calls</TableHead><TableHead className="text-right">Input tokens</TableHead><TableHead className="text-right">Output tokens</TableHead><TableHead className="w-40">Share of spend</TableHead></TableRow></TableHeader>
      <TableBody>{models.map((model) => <TableRow key={`${model.provider}/${model.modelId}`}>
        <TableCell className="font-medium">{model.modelId || "unknown"}</TableCell><TableCell className="text-muted-foreground">{model.provider || "unknown"}</TableCell>
        <TableCell className="text-right tabular-nums">{formatEur(model.spendEur)}</TableCell><TableCell className="text-right tabular-nums">{formatCount(model.calls)}</TableCell><TableCell className="text-right tabular-nums">{formatCount(model.inputTokens)}</TableCell><TableCell className="text-right tabular-nums">{formatCount(model.outputTokens)}</TableCell>
        <TableCell><div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-chart-1" style={{ width: `${model.share * 100}%` }} /></div><span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{formatPercent(Math.round(model.share * 100))}</span></div></TableCell>
      </TableRow>)}</TableBody>
    </Table></div>}
  </Section>;
}

export function StageSpendCard({ stages }: { stages: UsageDashboard["stages"] }) {
  return <Section title="Spend by pipeline stage" description="Where in a turn, or around it, the money goes">{stages.length ? <StageBars stages={stages} /> : <p className="py-6 text-sm text-muted-foreground">No model calls in this range.</p>}</Section>;
}

export function LatencyCard({ dashboard, variant = "distribution" }: { dashboard: UsageDashboard; variant?: "distribution" | "trend" }) {
  const totals = dashboard.totals;
  return <Section title={variant === "distribution" ? "Latency" : "Latency over time"} description={variant === "distribution" ? "How long a finished turn took, end to end" : "Daily median and 95th percentile, estimated from the histogram"}>
    {variant === "distribution" && <dl className="mb-4 grid grid-cols-3 gap-4">{[{ label: "Median (p50)", value: totals.latencyP50Ms }, { label: "p95", value: totals.latencyP95Ms }, { label: "Mean", value: totals.meanLatencyMs }].map(({ label, value }) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-xl font-semibold tabular-nums">{formatDuration(value)}</dd></div>)}</dl>}
    {totals.turns === 0 ? <p className="py-6 text-sm text-muted-foreground">No finished turns in this range.</p> : variant === "distribution" ? <LatencyHistogram buckets={dashboard.latency} /> : <LatencyTrend daily={dashboard.daily} />}
  </Section>;
}

export function RatesComparisonCard({ current, previous, loading = false }: { current: UsageDashboard["totals"]; previous: UsageDashboard["totals"] | null; loading?: boolean }) {
  return <Section title="Change from the prior period" description="The same rates in consecutive periods of equal length. Changes are percentage points.">{loading ? <div aria-label="Loading comparison" className="h-64 animate-pulse rounded-lg bg-muted/40 motion-reduce:animate-none" /> : <RateComparison current={current} previous={previous} />}</Section>;
}

export function FlowRankingCard({ flows }: { flows: UsageDashboard["flows"] }) {
  return <Section title="Most used Flows" description={`Top five by turns, ranked against each other ${flows.granularity === "week" ? "per week" : "per day"}`}><FlowBumpChart flows={flows} /></Section>;
}
