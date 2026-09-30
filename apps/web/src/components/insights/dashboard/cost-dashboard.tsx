"use client";

import type { UsageDashboardFilter } from "@agent-hub/core";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount, formatPercent, formatShortDay } from "@/lib/format";
import type { DashboardView } from "@/lib/insights/dashboard-filter";
import { costStats } from "@/lib/insights/dashboard-stats";
import { formatCompact, formatEur, tokenHighlights } from "@/lib/insights/dashboard-view";
import {
  DashboardFrame,
  DashboardStatCards,
  Section,
  SpendBars,
  StageBars,
  SurfaceComposition,
  TokenHeatCalendar,
  useDashboardView,
  type AssistantOption,
} from "./dashboard-kit";
import { SURFACE_COLORS, SURFACE_LABELS } from "./palette";

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
  const highlights = tokenHighlights(dashboard.daily);
  const surfaceSpend = dashboard.surfaces.reduce((sum, s) => sum + s.spendEur, 0);

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

      <Section
        title="Estimated spend per day"
        description={filter.surface ? `${SURFACE_LABELS[filter.surface]} only` : "Stacked by the surface that spent it"}
      >
        <SpendBars daily={dashboard.daily} surface={filter.surface} />
      </Section>

      <div className="grid grid-cols-12 gap-4">
          <Section
            title="Token usage"
            description="Input and output tokens per day. Click a day, then another, to total a span."
            className="col-span-12 @5xl:col-span-5"
          >
            <div className="overflow-x-auto">
              <TokenHeatCalendar daily={dashboard.daily} />
            </div>
            <dl className="mt-6 grid grid-cols-3 gap-4 border-t pt-4 text-sm">
              <div>
                <dt className="text-muted-foreground text-xs">Busiest day</dt>
                <dd className="font-medium tabular-nums">
                  {highlights.peakDay ? `${formatShortDay(highlights.peakDay)} · ${formatCompact(highlights.peakTokens)}` : "\u2014"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Daily average</dt>
                <dd className="font-medium tabular-nums">{formatCompact(highlights.averageTokens)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Busiest weekday</dt>
                <dd className="font-medium">{highlights.busiestWeekday ?? "\u2014"}</dd>
              </div>
            </dl>
          </Section>

          <Section
            title="Spend by surface"
            description="Each surface's share, whichever one is selected above"
            className="col-span-12 @5xl:col-span-7"
          >
            <SurfaceComposition daily={dashboard.daily} />
            {/* The legend reads one period; these are the window's totals. */}
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-sm @md:grid-cols-4">
              {dashboard.surfaces.map((row) => (
                <div key={row.surface} className="min-w-0">
                  <dt className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: SURFACE_COLORS[row.surface].light }}
                    />
                    {SURFACE_LABELS[row.surface]}
                  </dt>
                  <dd className="font-medium tabular-nums">
                    {formatEur(row.spendEur)}{" "}
                    <span className="text-muted-foreground font-normal">
                      · {formatPercent(Math.round((surfaceSpend > 0 ? row.spendEur / surfaceSpend : 0) * 100))}
                    </span>
                  </dd>
                  <dd className="text-muted-foreground truncate text-xs tabular-nums">
                    {formatCount(row.calls)} calls · {formatCompact(row.tokens)} tokens
                  </dd>
                </div>
              ))}
            </dl>
          </Section>
      </div>

        <Section title="Models" description="Every model that ran in this range, by estimated spend">
          {dashboard.models.length === 0 ? (
            <p className="text-muted-foreground py-6 text-sm">No model calls in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead className="text-right">Estimated spend</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Input tokens</TableHead>
                    <TableHead className="text-right">Output tokens</TableHead>
                    <TableHead className="w-40">Share of spend</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.models.map((model) => (
                    <TableRow key={`${model.provider}/${model.modelId}`}>
                      <TableCell className="font-medium">{model.modelId || "unknown"}</TableCell>
                      <TableCell className="text-muted-foreground">{model.provider || "unknown"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatEur(model.spendEur)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCount(model.calls)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCount(model.inputTokens)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCount(model.outputTokens)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
                            <div
                              className="h-full rounded-full bg-[#2a78d6] dark:bg-[#3987e5]"
                              style={{ width: `${model.share * 100}%` }}
                            />
                          </div>
                          <span className="text-muted-foreground w-9 text-right text-xs tabular-nums">
                            {formatPercent(Math.round(model.share * 100))}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Section>

      <Section title="Spend by pipeline stage" description="Where in a turn, or around it, the money goes">
        {dashboard.stages.length === 0 ? (
          <p className="text-muted-foreground py-6 text-sm">No model calls in this range.</p>
        ) : (
          <StageBars stages={dashboard.stages} />
        )}
      </Section>
    </DashboardFrame>
  );
}
