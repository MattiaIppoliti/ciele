"use client";

import type { UsageDashboardFilter } from "@agent-hub/core";
import type { DashboardView } from "@/lib/insights/dashboard-filter";
import { costStats } from "@/lib/insights/dashboard-stats";
import { DashboardFrame, DashboardStatCards, useDashboardView, type AssistantOption } from "./dashboard-kit";
import { SpendTrendCard, TokenActivityCard, SurfaceSpendCard, ModelSpendCard, ModelUsageCard, StageSpendCard } from "./dashboard-blocks";

/**
 * The Costs dashboard: what the Organization's AI spends, on what, where and
 * through which models. Estimated at list prices; never an invoice.
 */
export function CostDashboard({
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

  return (
    <DashboardFrame
      title="Costs"
      hint="Spend is estimated from token counts at list prices, in euros. It is not an invoice."
      filter={filter}
      setFilter={setFilter}
      refreshing={refreshing}
      unavailable={view.unavailable}
      assistants={assistants}
      exportRows={() =>
        dashboard.daily.map((d) => ({
          day: d.day,
          estimated_spend_eur: d.spendEur.toFixed(6),
          assistants_eur: d.spendBySurface.assistants.toFixed(6),
          teammates_eur: d.spendBySurface.teammates.toFixed(6),
          internal_eur: d.spendBySurface.internal.toFixed(6),
          unattributed_eur: d.spendBySurface.unattributed.toFixed(6),
          model_calls: d.calls,
          input_tokens: d.inputTokens,
          output_tokens: d.outputTokens,
        }))
      }
    >
      <DashboardStatCards specs={costStats(dashboard, view.previous)} loading={stale} />

      <SpendTrendCard daily={dashboard.daily} surface={filter.surface} />
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 @5xl:col-span-5"><TokenActivityCard daily={dashboard.daily} totals={dashboard.totals} /></div>
        <div className="col-span-12 @5xl:col-span-7"><SurfaceSpendCard daily={dashboard.daily} surfaces={dashboard.surfaces} surface={filter.surface} /></div>
      </div>
      <ModelSpendCard models={dashboard.models} />
      <ModelUsageCard models={dashboard.models} />
      <StageSpendCard stages={dashboard.stages} />
    </DashboardFrame>
  );
}
