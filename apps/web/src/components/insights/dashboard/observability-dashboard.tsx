"use client";

import type { UsageDashboardFilter } from "@agent-hub/core";
import { formatCount } from "@/lib/format";
import type { DashboardView } from "@/lib/insights/dashboard-filter";
import { observabilityStats } from "@/lib/insights/dashboard-stats";
import { formatDuration } from "@/lib/insights/dashboard-view";
import {
  DashboardFrame,
  DashboardStatCards,
  FlowBumpChart,
  LatencyHistogram,
  LatencyTrend,
  OutcomeBars,
  RateCard,
  Section,
  VerdictBars,
  useDashboardView,
  type AssistantOption,
} from "./dashboard-kit";

/**
 * The Observability dashboard: how reliably and how fast the AI answers, how
 * often the verifier finds it right, how often it needs a human, and which
 * Flows carry the traffic.
 */
export function ObservabilityDashboard({
  initial,
  initialFilter,
  assistants,
}: {
  initial: DashboardView;
  initialFilter: UsageDashboardFilter;
  assistants: AssistantOption[];
}) {
  const { filter, setFilter, view, refreshing, stale } = useDashboardView(initial, initialFilter);
  const { dashboard } = view;
  const totals = dashboard.totals;
  const assistantScoped = filter.surface === "" || filter.surface === "assistants";

  return (
    <DashboardFrame
      title="Observability"
      hint="Latency percentiles are estimated from a histogram of turn durations. Accuracy and autonomy measure Assistants only."
      filter={filter}
      setFilter={setFilter}
      refreshing={refreshing}
      unavailable={view.unavailable}
      assistants={assistants}
      exportRows={() =>
        dashboard.daily.map((d) => ({
          day: d.day,
          turns: d.turns,
          failed_turns: d.failedTurns,
          latency_p50_ms: d.latencyP50Ms ?? "",
          latency_p95_ms: d.latencyP95Ms ?? "",
          verdicts_passed: d.passes,
          verdicts_failed: d.fails,
          conversations: d.conversations,
          escalated: d.escalated,
        }))
      }
    >
      <DashboardStatCards specs={observabilityStats(dashboard, view.previous)} loading={stale} />

        <div className="grid grid-cols-12 gap-4">
          <Section
            title="Latency"
            description="How long a finished turn took, end to end"
            className="col-span-12 xl:col-span-6"
          >
            <dl className="mb-4 grid grid-cols-3 gap-4">
              {[
                ["Median (p50)", totals.latencyP50Ms],
                ["p95", totals.latencyP95Ms],
                ["Mean", totals.meanLatencyMs],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-muted-foreground text-xs">{label}</dt>
                  <dd className="text-xl font-semibold tabular-nums">{formatDuration(value as number | null)}</dd>
                </div>
              ))}
            </dl>
            {totals.turns === 0 ? (
              <p className="text-muted-foreground py-6 text-sm">No finished turns in this range.</p>
            ) : (
              <LatencyHistogram buckets={dashboard.latency} />
            )}
          </Section>
          <Section
            title="Latency over time"
            description="Daily median and 95th percentile, estimated from the histogram"
            className="col-span-12 xl:col-span-6"
          >
            {totals.turns === 0 ? (
              <p className="text-muted-foreground py-6 text-sm">No finished turns in this range.</p>
            ) : (
              <LatencyTrend daily={dashboard.daily} />
            )}
          </Section>
        </div>

        <div className="grid grid-cols-12 gap-4">
          <RateCard
            title="Reliability"
            description="Turns that finished without an error"
            good={totals.succeededTurns}
            bad={totals.failedTurns}
            goodLabel="Succeeded"
            badLabel="Failed"
            loading={stale}
            detail={
              totals.toolCallsPerTurn === null ? undefined : `${totals.toolCallsPerTurn.toFixed(1)} tool calls per turn`
            }
            empty="No finished turns in this range."
            className="col-span-12 lg:col-span-6 xl:col-span-4"
          >
            <OutcomeBars daily={dashboard.daily} />
            {dashboard.errors.length > 0 && (
              <ul className="space-y-1 text-sm">
                {dashboard.errors.slice(0, 4).map((error) => (
                  <li key={error.errorClass} className="flex justify-between gap-3">
                    <code className="text-muted-foreground truncate text-xs">{error.errorClass}</code>
                    <span className="tabular-nums">{formatCount(error.turns)}</span>
                  </li>
                ))}
              </ul>
            )}
          </RateCard>
          <RateCard
            title="Answer accuracy"
            description="Verifier verdicts on Assistant answers"
            good={totals.passes}
            bad={totals.fails}
            goodLabel="Passed"
            badLabel="Failed"
            loading={stale}
            empty={
              assistantScoped
                ? "The verifier graded no answers in this range."
                : "The verifier grades Assistant answers only, so there is nothing to show for this surface."
            }
            className="col-span-12 lg:col-span-6 xl:col-span-4"
          >
            <VerdictBars daily={dashboard.daily} />
          </RateCard>
          <RateCard
            title="Autonomy"
            description="Visitor conversations resolved without a human"
            good={totals.conversations - totals.escalated}
            bad={totals.escalated}
            goodLabel="Resolved by AI"
            badLabel="Escalated"
            loading={stale}
            empty={
              assistantScoped
                ? "No Visitor conversations started in this range."
                : "Only Assistant conversations can be escalated, so there is nothing to show for this surface."
            }
            className="col-span-12 lg:col-span-6 xl:col-span-4"
          />
        </div>

      <Section
        title="Most used Flows"
        description={`Top five by turns, ranked against each other ${dashboard.flows.granularity === "week" ? "per week" : "per day"}`}
      >
        <FlowBumpChart flows={dashboard.flows} />
      </Section>
    </DashboardFrame>
  );
}
