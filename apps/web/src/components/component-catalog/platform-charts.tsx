"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@agent-hub/ui";
import { RadialGauge } from "@agent-hub/charts";
import { ArcFrame } from "@/components/charts/arc/arc-frame";
import { LineChart } from "@/components/charts/arc/line-chart/line-chart";
import { BarChart } from "@/components/charts/arc/bar-chart/bar-chart";
import { DonutChart } from "@/components/charts/arc/donut-chart/donut-chart";
import { BrushChart } from "@/components/charts/arc/brush-chart/brush-chart";
import { Treemap } from "@/components/charts/arc/treemap/treemap";
import { Streamgraph } from "@/components/charts/arc/streamgraph/streamgraph";
import { SlopeChart } from "@/components/charts/arc/slope-chart/slope-chart";
import { Ridgeline } from "@/components/charts/arc/ridgeline/ridgeline";
import { ActivityHeatmap } from "@/components/charts/arc/activity-heatmap/activity-heatmap";
import { Sparkline } from "@/components/charts/arc/sparkline/sparkline";
import { WaffleChart } from "@/components/charts/arc/waffle-chart/waffle-chart";
import { MetricCard } from "@/components/charts/arc/metric-card/metric-card";
import { AnimatedCounter } from "@/components/charts/arc/animated-counter/animated-counter";
import { Gauge } from "@/components/charts/arc/gauge/gauge";
import { BumpChart } from "@/components/charts/beui/bump-chart";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Bar, BarChart as RechartsBarChart, CartesianGrid, XAxis } from "recharts";
import { AnalyticsCard } from "@/components/insights/analytics-card";
import { InsightsStatCard } from "@/components/insights/insights-stat-card";
import { DashboardStatCards } from "@/components/insights/dashboard/dashboard-stat-cards";

const VALUES = [26, 38, 31, 47, 40, 58, 52];
const PERIODS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SERIES = [{ key: "resolved", label: "Resolved" }, { key: "escalated", label: "Escalated", dashed: true }];
const PARTS = [{ key: "knowledge", label: "Knowledge", value: 58 }, { key: "courtesy", label: "Courtesy", value: 27 }, { key: "support", label: "Support", value: 15 }];

function ChartExample({ title, children }: { title: string; children: ReactNode }) {
  return <section className="min-w-0 space-y-4 rounded-xl border bg-card p-5"><h3 className="text-sm font-medium">{title}</h3>{children}</section>;
}

export function ChartsPreview({ slug }: { slug: string }) {
  const [alternate, setAlternate] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const values = VALUES.map((value, index) => alternate ? value + (index % 2 === 0 ? 16 : -10) : value);
  const data = values.map((value, index) => ({ key: PERIODS[index], label: PERIODS[index], axisLabel: PERIODS[index], values: { resolved: value, escalated: 7 + index * 2 } }));
  const parts = PARTS.map((part, index) => ({ ...part, value: alternate ? part.value + (index === 0 ? -12 : 6) : part.value }));
  let chart: ReactNode;
  switch (slug) {
    case "charts": chart = <LineChart data={data} series={SERIES} label="Answers over time" height={180} />; break;
    case "bar-chart": chart = <BarChart data={values.map((value, index) => ({ key: PERIODS[index], label: PERIODS[index], axisLabel: PERIODS[index].slice(0, 1), value }))} label="Conversations" period="Sample week" height={150} />; break;
    case "donut-chart": chart = <DonutChart data={parts} label="Answer types" size={180} />; break;
    case "waffle-chart": chart = <WaffleChart data={parts} label="Resolution breakdown" />; break;
    case "streamgraph": chart = <Streamgraph data={data} series={SERIES} label="Conversation mix" height={180} />; break;
    case "bump-chart": chart = <BumpChart label="Popular topics" periods={["Week 1", "Week 2", "Week 3", "Week 4"]} series={[{ id: "policies", name: "Policies", ranks: alternate ? [2, 1, 2, 1] : [1, 2, 1, 2] }, { id: "access", name: "Access", ranks: alternate ? [1, 2, 1, 2] : [2, 1, 2, 1] }, { id: "billing", name: "Billing", ranks: [3, 3, 3, 3] }]} />; break;
    case "slope-chart": chart = <SlopeChart label="Topic resolution" startLabel="Before" endLabel="After" height={170} data={[{ key: "access", label: "Access", start: 58, end: alternate ? 84 : 73 }, { key: "billing", label: "Billing", start: 72, end: alternate ? 68 : 81 }, { key: "policies", label: "Policies", start: 64, end: alternate ? 88 : 76 }]} />; break;
    case "ridgeline": chart = <Ridgeline label="Answer duration" unit="s" series={[{ id: "a", label: "Assistant", values: values.map((value) => value / 10) }, { id: "b", label: "Teammate", values: values.map((value) => value / 7) }, { id: "c", label: "Support", values: values.map((value) => value / 5) }]} />; break;
    case "treemap": chart = <Treemap label="Knowledge coverage" height={230} data={{ id: "root", label: "Collections", children: [{ id: "policies", label: "Policies", children: [{ id: "account", label: "Accounts", value: alternate ? 34 : 21 }, { id: "privacy", label: "Privacy", value: 15 }] }, { id: "guides", label: "Guides", children: [{ id: "start", label: "Getting started", value: 28 }, { id: "advanced", label: "Advanced", value: 19 }] }] }} />; break;
    case "brush-chart": chart = <BrushChart label="Daily conversations" height={160} minSpan={3 * 86_400_000} data={Array.from({ length: 30 }, (_, index) => ({ date: Date.UTC(2026, 8, index + 1), value: values[index % values.length] + index }))} />; break;
    case "activity-heatmap": chart = <ActivityHeatmap label="Conversation activity" period="September 2026" selectedDate={selectedDate} onSelectDate={setSelectedDate} days={Array.from({ length: 30 }, (_, index) => ({ date: new Date(Date.UTC(2026, 8, index + 1)).toISOString().slice(0, 10), count: values[index % values.length] % 19 }))} />; break;
    case "sparkline": chart = <Sparkline label="Weekly conversations" data={values} value={String(values.reduce((sum, value) => sum + value, 0))} change="+12% this week" labels={PERIODS} width={260} height={72} />; break;
    case "chart-container": chart = <ChartContainer className="h-52 w-full" config={{ conversations: { label: "Conversations", color: "var(--chart-1)" } }}><RechartsBarChart accessibilityLayer data={values.map((conversations, index) => ({ day: PERIODS[index], conversations }))}><CartesianGrid vertical={false} /><XAxis dataKey="day" tickLine={false} axisLine={false} /><ChartTooltip content={<ChartTooltipContent />} /><Bar dataKey="conversations" fill="var(--color-conversations)" radius={4} /></RechartsBarChart></ChartContainer>; break;
    case "arc-frame": chart = <div className="space-y-3"><p className="text-sm">This frame connects chart content to the active appearance.</p><div className="flex gap-2">{[1, 2, 3, 4, 5].map((index) => <span key={index} className="size-9 rounded-md" style={{ backgroundColor: `var(--chart-${index})` }} />)}</div></div>; break;
    default: throw new Error(`Unknown chart preview: ${slug}`);
  }
  return (
    <div className="w-full max-w-3xl space-y-5">
      {slug !== "arc-frame" && <div className="flex flex-wrap items-center gap-3"><Button variant="outline" size="sm" onClick={() => setAlternate(!alternate)}>Change sample data</Button><span className="text-xs text-muted-foreground">Hover, focus or select the chart to explore the data.</span></div>}
      <ArcFrame className="min-w-0">{chart}</ArcFrame>
    </div>
  );
}

export function MetricCardsPreview({ slug }: { slug: string }) {
  const [updated, setUpdated] = useState(false);
  const [loading, setLoading] = useState(false);
  let content: ReactNode;
  switch (slug) {
    case "insights-stat-card": content = <div className="grid gap-4 @xl:grid-cols-3"><InsightsStatCard title="Resolution rate" value={updated ? "88.4%" : "82.7%"} numericValue={updated ? 88.4 : 82.7} suffix="%" decimals={1} /><InsightsStatCard title="Conversation time" value="2m 30s" /><InsightsStatCard title="Answer rating" value="N/A" subtitle="No ratings in the selected range" /></div>; break;
    case "metric-cards": content = <ArcFrame className="grid gap-4 @xl:grid-cols-2"><MetricCard label="Conversations" value={updated ? 2841 : 2468} context="Past 30 days" change="+15.1%"><Sparkline label="Conversation trend" data={VALUES} width={220} height={48} /></MetricCard><MetricCard label="Resolution rate" value={updated ? 88.4 : 82.7} decimals={1} suffix="%" context="Answers resolved by AI" change="+5.7 points" /><MetricCard bare label="Average response" value={updated ? 1.8 : 2.4} decimals={1} suffix="s" context="Median answer time" /></ArcFrame>; break;
    case "animated-counter": content = <ArcFrame><AnimatedCounter value={updated ? 2841 : 2468} label="Conversations" /></ArcFrame>; break;
    case "analytics-card": content = <AnalyticsCard title="Conversations" description="Daily conversation volume over the sample week." action={<Button variant="outline" size="sm" onClick={() => setUpdated(!updated)}>Update</Button>}><ArcFrame><Sparkline label="Daily conversations" data={updated ? [...VALUES].reverse() : VALUES} width={600} height={80} /></ArcFrame></AnalyticsCard>; break;
    case "dashboard-stat-cards": content = <div className="space-y-4"><Button variant="outline" size="sm" onClick={() => setLoading(!loading)}>{loading ? "Reveal metrics" : "Show loading"}</Button><DashboardStatCards loading={loading} specs={[{ key: "conversations", label: "Conversations", kind: "count", value: updated ? 2841 : 2468, previous: 2210, series: VALUES, labels: PERIODS, goodWhen: "up", caption: "Past 30 days" }, { key: "response", label: "Average response", kind: "ms", value: updated ? 1800 : 2400, previous: 2800, series: VALUES.map((value) => 3000 - value * 20), labels: PERIODS, goodWhen: "down", caption: "Median answer time" }]} /></div>; break;
    default: throw new Error(`Unknown metric preview: ${slug}`);
  }
  return <div className="w-full max-w-3xl space-y-5"><Button variant="outline" size="sm" onClick={() => setUpdated(!updated)}>Update metrics</Button>{content}</div>;
}

export function GaugesPreview({ slug }: { slug: string }) {
  const [value, setValue] = useState(72);
  return (
    <div className="w-full space-y-6">
      <label className="flex flex-wrap items-center gap-4 text-sm">Sample value <input className="w-48 accent-primary" aria-label="Gauge value" type="range" min="0" max="100" value={value} onChange={(event) => setValue(Number(event.target.value))} /><span className="tabular-nums">{value}%</span></label>
      {slug === "radial-gauge" ? <div className="flex items-center gap-5"><RadialGauge size={120} rings={[{ fraction: value / 100, toneClass: "stroke-primary", label: `This week: ${value}% used` }, { fraction: value / 140, toneClass: "stroke-muted-foreground", label: "This month" }]}><span className="text-lg font-medium tabular-nums">{value}%</span></RadialGauge><p className="text-sm text-muted-foreground">One ring per measured window.</p></div> : <ArcFrame className="grid gap-5 @xl:grid-cols-2"><ChartExample title="Default"><Gauge value={value} label="Resolution rate" detail="Sample answers" thresholds={[{ from: 0, tone: "danger", label: "Needs attention" }, { from: 40, tone: "warning", label: "Improving" }, { from: 70, tone: "success", label: "Healthy" }]} /></ChartExample><ChartExample title="Compact"><Gauge compact value={value} label="Weekly usage" detail="of the sample allowance" /></ChartExample></ArcFrame>}
    </div>
  );
}
