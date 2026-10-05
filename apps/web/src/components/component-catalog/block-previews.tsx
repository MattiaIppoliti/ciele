"use client";

import { useState } from "react";
import type { DashboardSurface, Flow, UsageDashboard } from "@agent-hub/core";
import { Button } from "@agent-hub/ui";
import { OverviewActivity, OverviewChecklist, OverviewQuality } from "@/components/assistant/overview-blocks";
import { OverviewFlows, OverviewKnowledge, OverviewConversations, type OverviewSource, type OverviewConversation } from "@/components/assistant/overview-resource-blocks";
import { ConversationDepthCard } from "@/components/insights/conversation-depth-card";
import { UsageCard } from "@/components/insights/insights-chart";
import { DashboardStatCards } from "@/components/insights/dashboard/dashboard-stat-cards";
import { OutcomeBars, VerdictBars, RateCard } from "@/components/insights/dashboard/dashboard-kit";
import { SpendTrendCard, TokenActivityCard, SurfaceSpendCard, ModelSpendCard, ModelUsageCard, StageSpendCard, LatencyCard, RatesComparisonCard, FlowRankingCard } from "@/components/insights/dashboard/dashboard-blocks";
import { activityStats, costStats, observabilityStats } from "@/lib/insights/dashboard-stats";
import { formatCount } from "@/lib/format";
import { BLOCK_DASHBOARD, EMPTY_BLOCK_DASHBOARD, BLOCK_PREVIOUS } from "./block-data";

const PREVIEW_BASE = "#block-preview";
const NOW = "2026-09-22T12:00:00Z";
const FLOWS: Flow[] = ["Search knowledge", "Basic Interaction", "Default behavior"].map((name, position) => ({
  id: `flow-${position}`, assistantId: "catalog", name, description: "", builtIn: position > 0,
  enabled: true, position, trigger: "message", triggerSettings: {}, conditionLogic: "all", conditions: [],
  actions: [], actionSettings: {}, customMessage: "", isDefault: position === 2,
}));
const SOURCES: OverviewSource[] = [
  { id: "guide", kind: "file", name: "Getting started.pdf", status: "ready", error: "", createdAt: "2026-09-22T08:00:00Z" },
  { id: "website", kind: "website", name: "Help center", status: "processing", error: "", createdAt: "2026-09-21T10:00:00Z" },
];
const CONVERSATIONS: OverviewConversation[] = [
  { id: "access", title: "Invite a teammate", subjectType: "visitor", metadata: { userName: "Alex" }, flowNames: ["Search knowledge"], feedback: 1, messageCount: 6, updatedAt: "2026-09-22T10:00:00Z" },
  { id: "setup", title: "Connect a knowledge source", subjectType: "visitor", metadata: {}, flowNames: ["Default behavior"], feedback: 0, messageCount: 4, updatedAt: "2026-09-21T15:00:00Z" },
];

function Choices({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <div className="flex flex-wrap items-center gap-1 rounded-xl bg-alpha-lighter p-1" role="group" aria-label={label}>
    {options.map((option) => <Button key={option.value} size="sm" variant={value === option.value ? "secondary" : "ghost"} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</Button>)}
  </div>;
}

function UsagePreview({ dashboard }: { dashboard: UsageDashboard }) {
  const counts = dashboard.daily.map((day) => day.conversations);
  return <UsageCard labels={dashboard.days} metrics={[
    { key: "Conversations", color: "var(--chart-1)", values: counts },
    { key: "Questions", color: "var(--chart-2)", values: dashboard.daily.map((day) => day.turns) },
  ]} defaultVisibleMetrics={["Conversations", "Questions"]}
    assistants={[{ key: "Support", label: "Support assistant", color: "var(--chart-1)", values: counts.map((count) => Math.round(count * .65)), total: Math.round(dashboard.totals.conversations * .65), percent: 65 }, { key: "Product", label: "Product assistant", color: "var(--chart-2)", values: counts.map((count) => Math.round(count * .35)), total: Math.round(dashboard.totals.conversations * .35), percent: 35 }]}
    channels={[{ key: "Website", label: "Website widget", color: "var(--chart-1)", values: counts.map((count) => Math.round(count * .8)), total: Math.round(dashboard.totals.conversations * .8), percent: 80 }, { key: "Preview", label: "Preview", color: "var(--chart-2)", values: counts.map((count) => Math.round(count * .2)), total: Math.round(dashboard.totals.conversations * .2), percent: 20 }]}
    fetchedAt={Date.UTC(2026, 8, 22)} />;
}

export default function BlockPreview({ slug }: { slug: string }) {
  const [state, setState] = useState("populated");
  const [variant, setVariant] = useState(slug === "metric-grid" ? "activity" : slug === "rate-cards" ? "reliability" : "distribution");
  const [surface, setSurface] = useState<DashboardSurface | "">("");
  const empty = state === "empty";
  const loading = state === "loading";
  const dashboard = empty ? EMPTY_BLOCK_DASHBOARD : BLOCK_DASHBOARD;
  const totals = dashboard.totals;
  const hasLoading = ["activity", "metric-grid", "rate-cards", "rate-comparison"].includes(slug);
  const states = slug === "setup-checklist"
    ? [{ value: "populated", label: "In progress" }, { value: "empty", label: "Not started" }, { value: "complete", label: "Complete" }]
    : [{ value: "populated", label: "Sample data" }, { value: "empty", label: "Empty" }, ...(hasLoading ? [{ value: "loading", label: "Loading" }] : [])];
  let block: React.ReactNode;
  switch (slug) {
    case "setup-checklist": block = state === "complete" ? <p role="status" className="rounded-xl border p-8 text-center text-sm text-muted-foreground">Setup complete. The platform hides this block when every step is done.</p> : <OverviewChecklist steps={[
      { label: "Add knowledge sources", section: "Knowledge", href: PREVIEW_BASE, done: false },
      { label: "Create a flow", section: "Flows", href: PREVIEW_BASE, done: !empty },
      { label: "Publish the widget", section: "Publish", href: PREVIEW_BASE, done: !empty },
    ]} />; break;
    case "activity": block = <OverviewActivity activity={dashboard} previousActivity={BLOCK_PREVIOUS} href={PREVIEW_BASE} periodLabel="Selected range" deltaLabel="vs prior period" loading={loading} />; break;
    case "quality": block = <OverviewQuality totals={totals} previous={BLOCK_PREVIOUS} href={PREVIEW_BASE} costsHref={PREVIEW_BASE} />; break;
    case "flow-list": block = <OverviewFlows flows={empty ? [] : FLOWS} base={PREVIEW_BASE} />; break;
    case "knowledge-list": block = <OverviewKnowledge sources={empty ? [] : SOURCES} sourceCount={empty ? 0 : 2} collectionCount={empty ? 0 : 1} base={PREVIEW_BASE} now={NOW} />; break;
    case "conversation-list": block = <OverviewConversations conversations={empty ? [] : CONVERSATIONS} assistantId="catalog" now={NOW} />; break;
    case "metric-grid": block = <DashboardStatCards specs={(variant === "costs" ? costStats : variant === "observability" ? observabilityStats : activityStats)(dashboard, BLOCK_PREVIOUS)} loading={loading} />; break;
    case "usage": block = <UsagePreview dashboard={dashboard} />; break;
    case "conversation-depth": block = <ConversationDepthCard labels={dashboard.days} series={[{ key: "Avg. conversation time", values: dashboard.days.map((_, index) => empty ? 0 : 80 + index * 4) }, { key: "Questions / Conversation", values: dashboard.days.map((_, index) => empty ? 0 : 2 + index % 4) }]} avgConversationSeconds={empty ? null : 120} questionsPerConversation={empty ? null : 3.2} />; break;
    case "spend-trend": block = <SpendTrendCard daily={dashboard.daily} surface={surface} />; break;
    case "token-activity": block = <TokenActivityCard daily={dashboard.daily} totals={dashboard.totals} />; break;
    case "spend-composition": block = <SurfaceSpendCard daily={dashboard.daily} surfaces={dashboard.surfaces} />; break;
    case "model-spend": block = <ModelSpendCard models={dashboard.models} />; break;
    case "model-usage": block = <ModelUsageCard models={dashboard.models} />; break;
    case "stage-spend": block = <StageSpendCard stages={dashboard.stages} />; break;
    case "latency": block = <LatencyCard dashboard={dashboard} variant={variant === "trend" ? "trend" : "distribution"} />; break;
    case "rate-comparison": block = <RatesComparisonCard current={totals} previous={variant === "no-prior" ? null : BLOCK_PREVIOUS} loading={loading} />; break;
    case "flow-ranking": block = <FlowRankingCard flows={dashboard.flows} />; break;
    case "rate-cards": block = variant === "accuracy" ? <RateCard variant="gauge" title="Answer accuracy" description="Verifier verdicts on Assistant answers" good={totals.passes} bad={totals.fails} goodLabel="Passed" badLabel="Failed" empty="The verifier graded no answers in this range." loading={loading}><VerdictBars daily={dashboard.daily} /></RateCard>
      : variant === "autonomy" ? <RateCard title="Autonomy" description="Visitor conversations resolved without a human" variant="gauge" good={totals.conversations - totals.escalated} bad={totals.escalated} goodLabel="Resolved by AI" badLabel="Escalated" empty="No Visitor conversations started in this range." loading={loading} />
      : <RateCard title="Reliability" description="Turns that finished without an error" variant="gauge" good={totals.succeededTurns} bad={totals.failedTurns} goodLabel="Succeeded" badLabel="Failed" detail={totals.toolCallsPerTurn === null ? undefined : `${totals.toolCallsPerTurn.toFixed(1)} tool calls per turn`} empty="No finished turns in this range." loading={loading}><OutcomeBars daily={dashboard.daily} />{dashboard.errors.length > 0 && <ul className="space-y-1 text-sm">{dashboard.errors.slice(0, 4).map((error) => <li key={error.errorClass} className="flex justify-between gap-3"><code className="truncate text-xs text-muted-foreground">{error.errorClass}</code><span className="tabular-nums">{formatCount(error.turns)}</span></li>)}</ul>}</RateCard>; break;
  }
  const variants = slug === "metric-grid" ? [{ value: "activity", label: "Activity" }, { value: "costs", label: "Costs" }, { value: "observability", label: "Observability" }]
    : slug === "rate-cards" ? [{ value: "reliability", label: "Reliability" }, { value: "accuracy", label: "Accuracy" }, { value: "autonomy", label: "Autonomy" }]
    : slug === "latency" ? [{ value: "distribution", label: "Distribution" }, { value: "trend", label: "Trend" }]
    : slug === "rate-comparison" ? [{ value: "distribution", label: "Comparison" }, { value: "no-prior", label: "No prior period" }] : [];
  return <div className="w-full space-y-6">
    <div className="flex flex-wrap gap-3"><Choices label="Block sample state" value={state} options={states} onChange={setState} />{variants.length > 0 && <Choices label="Block variant" value={variant} options={variants} onChange={setVariant} />}
      {slug === "spend-trend" && <Choices label="Spend surface" value={surface} options={[{ value: "", label: "All surfaces" }, { value: "assistants", label: "Assistants" }, { value: "teammates", label: "Teammates" }]} onChange={(value) => { if (value === "" || value === "assistants" || value === "teammates") setSurface(value); }} />}
    </div>
      <div id="block-preview" className={`${["activity", "setup-checklist", "quality", "flow-list", "knowledge-list", "conversation-list"].includes(slug) ? "assistant-overview" : ""} ${["activity", "setup-checklist", "quality", "rate-cards"].includes(slug) ? "mx-auto max-w-lg" : ""}`}>{block}</div>
  </div>;
}
