"use client";

import type { UsageDashboardFilter } from "@agent-hub/core";
import { formatCount } from "@/lib/format";
import type { DashboardView } from "@/lib/insights/dashboard-filter";
import { observabilityStats } from "@/lib/insights/dashboard-stats";
import {
  DashboardFrame,
  DashboardStatCards,
  OutcomeBars,
  RateCard,
  VerdictBars,
  useDashboardView,
  type AssistantOption,
} from "./dashboard-kit";

import { LatencyCard, RatesComparisonCard, FlowRankingCard } from "./dashboard-blocks";

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
      hint="Histogram-estimated latency. Accuracy and autonomy cover Assistants only."
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
        <div className="col-span-12 @5xl:col-span-6"><LatencyCard dashboard={dashboard} /></div>
        <div className="col-span-12 @5xl:col-span-6"><LatencyCard dashboard={dashboard} variant="trend" /></div>
      </div>

        <div className="grid grid-cols-12 gap-4">
          <RateCard
            title="Reliability"
            variant="gauge"

            good={totals.succeededTurns}
            bad={totals.failedTurns}
            goodLabel="Succeeded"
            badLabel="Failed"
            loading={stale}
            detail={
              totals.toolCallsPerTurn === null ? undefined : `${totals.toolCallsPerTurn.toFixed(1)} tool calls per turn`
            }
            empty="No finished turns in this range."
            className="col-span-12 @3xl:col-span-6 @5xl:col-span-4"
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
            variant="gauge"
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
            className="col-span-12 @3xl:col-span-6 @5xl:col-span-4"
          >
            <VerdictBars daily={dashboard.daily} />
          </RateCard>
          <RateCard
            title="Autonomy"
            variant="gauge"
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
            className="col-span-12 @3xl:col-span-6 @5xl:col-span-4"
          />
        </div>

      <RatesComparisonCard current={totals} previous={view.previous} loading={stale} />
      <FlowRankingCard flows={dashboard.flows} />
    </DashboardFrame>
  );
}
