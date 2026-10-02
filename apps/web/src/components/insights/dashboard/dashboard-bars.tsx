"use client";

import type {
  DashboardDay,
  DashboardLatencyBucket,
  DashboardStageRow,
  DashboardSurface,
} from "@agent-hub/core";
import { ArcFrame } from "@/components/charts/arc/arc-frame";
import { BarChart } from "@/components/charts/arc/bar-chart/bar-chart";
import { Streamgraph } from "@/components/charts/arc/streamgraph/streamgraph";
import {
  formatCompact,
  formatEur,
  latencyBucketLabel,
} from "@/lib/insights/dashboard-view";
import { formatShortDay } from "@/lib/format";
import { OUTCOME_COLORS, SURFACE_LABELS } from "./palette";

const periodOf = (daily: DashboardDay[]) =>
  daily.length
    ? `${formatShortDay(daily[0]!.day)} – ${formatShortDay(daily[daily.length - 1]!.day)}`
    : "Selected range";

export function SpendBars({
  daily,
  surface,
}: {
  daily: DashboardDay[];
  surface: DashboardSurface | "";
}) {
  return (
    <ArcFrame>
      <BarChart
        label="Estimated spend per day"
        period={periodOf(daily)}
        data={daily.map((d) => ({
          key: d.day,
          label: d.day,
          axisLabel: formatShortDay(d.day),
          value: d.spendEur,
        }))}
        valueLabel="Estimated spend"
        averageLabel="Daily average"
        height={240}
        formatValue={formatEur}
        categoryLabel={
          surface ? `${SURFACE_LABELS[surface]} · UTC day` : "UTC day"
        }
      />
    </ArcFrame>
  );
}

function Outcomes({
  daily,
  verdicts = false,
}: {
  daily: DashboardDay[];
  verdicts?: boolean;
}) {
  return (
    <ArcFrame>
      <Streamgraph
        label={
          verdicts ? "Verifier verdicts per day" : "Finished turns per day"
        }
        offset="zero"
        height={180}
        directLabels={false}
        series={[
          {
            key: "good",
            label: verdicts ? "Passed" : "Succeeded",
            color: OUTCOME_COLORS.good.light,
          },
          { key: "bad", label: "Failed", color: OUTCOME_COLORS.bad.light },
        ]}
        data={daily.map((d) => ({
          key: d.day,
          label: d.day,
          axisLabel: formatShortDay(d.day),
          values: {
            good: verdicts ? d.passes : d.turns - d.failedTurns,
            bad: verdicts ? d.fails : d.failedTurns,
          },
        }))}
        formatValue={formatCompact}
        categoryLabel="UTC day"
      />
    </ArcFrame>
  );
}
export function OutcomeBars({ daily }: { daily: DashboardDay[] }) {
  return <Outcomes daily={daily} />;
}
export function VerdictBars({ daily }: { daily: DashboardDay[] }) {
  return <Outcomes daily={daily} verdicts />;
}

export function LatencyHistogram({
  buckets,
}: {
  buckets: DashboardLatencyBucket[];
}) {
  const lastUsed = buckets.reduce((last, b, i) => (b.turns > 0 ? i : last), 0);
  return (
    <ArcFrame>
      <BarChart
        label="Turn latency distribution"
        period="Selected range"
        categoryLabel="Duration bucket"
        showAverage={false}
        averageLabel="Mean turns per bucket"
        valueLabel="Turns"
        height={180}
        formatValue={formatCompact}
        data={buckets
          .slice(0, Math.max(lastUsed + 1, 6))
          .map((b, i) => ({
            key: String(i),
            label: latencyBucketLabel(b),
            axisLabel: latencyBucketLabel(b),
            value: b.turns,
          }))}
      />
    </ArcFrame>
  );
}

const STAGE_LABELS: Record<string, string> = {
  classify: "Classify",
  generate: "Generate",
  embed: "Embed",
  enrich: "Enrich",
  verify: "Verify",
  goal_eval: "Goal evaluation",
  evaluation: "Evaluation experiments",
  compost: "Compost",
  improvement_proposal: "Improvement proposal",
  graph_search: "Graph search",
  graph_cognify: "Graph cognify",
  rerank: "Rerank",
  memory_extract: "Memory extraction",
  agent_memory: "Agent memory",
  decide: "Decide",
};
export function StageBars({ stages }: { stages: DashboardStageRow[] }) {
  return (
    <ArcFrame>
      <BarChart
        label="Estimated spend by pipeline stage"
        period="Selected range"
        categoryLabel="Stage"
        showAverage={false}
        averageLabel="Average per stage"
        valueLabel="Estimated spend"
        height={220}
        formatValue={formatEur}
        data={stages.map((s) => ({
          key: s.stage,
          label: STAGE_LABELS[s.stage] ?? s.stage,
          axisLabel: STAGE_LABELS[s.stage] ?? s.stage,
          value: s.spendEur,
        }))}
      />
    </ArcFrame>
  );
}
