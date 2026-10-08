"use client";

import { AnalyticsCard } from "../analytics-card";
import { EmptyState } from "@/components/ui/empty-state";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Download } from "lucide-react";
import type { DashboardSurface, UsageDashboardFilter } from "@agent-hub/core";
import { recordsToCsv } from "@ciele/ops/csv";
import {
  Button,
  Skeleton,
} from "@agent-hub/ui";
import { SlidingPanel, useSlidingDirection } from "@/components/motion/sliding-panel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssistantFilterDropdown } from "@/components/insights/assistant-filter-dropdown";
import { DateRangeDropdown } from "@/components/insights/date-range-dropdown";
import { defaultDashboardFilter, type DashboardView } from "@/lib/insights/dashboard-filter";
import { INSIGHTS_RANGE_SLOT, SlotPortal, TOP_BAR_SLOT } from "@/components/shell/slot-portal";
import { InsightsRangeChip } from "@/components/insights/insights-range-chip";
import { replaceFilterParams } from "@/lib/url-state";

export { DashboardStatCards } from "./dashboard-stat-cards";

/**
 * What the Costs and Observability dashboards share: one filter, one fetch,
 * one header, the card shell, the stat cards and the lazily loaded charts. The
 * two pages differ only in which cards they arrange.
 */

export interface AssistantOption {
  id: string;
  title: string;
}

export function ChartSkeleton({ className }: { className: string }) {
  return <div aria-label="Loading chart" className={`bg-muted/40 animate-pulse rounded-lg ${className}`} />;
}

// The Arc charts and the specialized legacy charts stay off the route's first
// load: each card paints its frame, then its chart module arrives.
export const SpendBars = dynamic(() => import("./dashboard-bars").then((m) => m.SpendBars), {
  ssr: false,
  loading: () => <ChartSkeleton className="h-72" />,
});
export const OutcomeBars = dynamic(() => import("./dashboard-bars").then((m) => m.OutcomeBars), {
  ssr: false,
  loading: () => <ChartSkeleton className="h-56" />,
});
export const VerdictBars = dynamic(() => import("./dashboard-bars").then((m) => m.VerdictBars), {
  ssr: false,
  loading: () => <ChartSkeleton className="h-56" />,
});
export const LatencyHistogram = dynamic(() => import("./dashboard-bars").then((m) => m.LatencyHistogram), {
  ssr: false,
  loading: () => <ChartSkeleton className="h-56" />,
});
export const StageBars = dynamic(() => import("./dashboard-bars").then((m) => m.StageBars), {
  ssr: false,
  loading: () => <ChartSkeleton className="h-64" />,
});
export const ModelSpendTree = dynamic(() => import("./dashboard-comparisons").then((m) => m.ModelSpendTree), {
  ssr: false,
  loading: () => <ChartSkeleton className="h-80" />,
});
export const RateComparison = dynamic(() => import("./dashboard-comparisons").then((m) => m.RateComparison), {
  ssr: false,
  loading: () => <ChartSkeleton className="h-64" />,
});
export const TokenHeatCalendar = dynamic(() => import("./dashboard-animated").then((m) => m.TokenHeatCalendar), {
  ssr: false,
  loading: () => <ChartSkeleton className="h-44" />,
});
export const SurfaceComposition = dynamic(() => import("./dashboard-animated").then((m) => m.SurfaceComposition), {
  ssr: false,
  loading: () => <ChartSkeleton className="h-80" />,
});
export const FlowBumpChart = dynamic(() => import("./dashboard-animated").then((m) => m.FlowBumpChart), {
  ssr: false,
  loading: () => <ChartSkeleton className="h-72" />,
});
export const LatencyTrend = dynamic(() => import("./dashboard-animated").then((m) => m.LatencyTrend), {
  ssr: false,
  loading: () => <ChartSkeleton className="h-56" />,
});
const RateDonut = dynamic(() => import("./dashboard-donut").then((m) => m.RateDonut), {
  ssr: false,
  loading: () => <ChartSkeleton className="size-36 rounded-full" />,
});

/**
 * The filter, the view computed for it, and whether the two have drifted.
 * The debounce means a new filter is on screen before its numbers are; for
 * that gap `stale` is true and the cards show their loading states rather
 * than the previous filter's figures under the new filter's heading.
 */
export function useDashboardView(initial: DashboardView, initialFilter: UsageDashboardFilter) {
  const [filter, setFilter] = useState(initialFilter);
  const [view, setView] = useState(initial);
  const [viewFilter, setViewFilter] = useState(initialFilter);
  const [refreshing, setRefreshing] = useState(false);
  const firstRequest = useRef(true);

  // A reload or a copied link opens on the same range and filters.
  useEffect(() => {
    replaceFilterParams(filter, defaultDashboardFilter());
  }, [filter]);

  useEffect(() => {
    if (firstRequest.current) {
      firstRequest.current = false;
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setRefreshing(true);
      try {
        const response = await fetch(`/api/insights/dashboard?${new URLSearchParams({ ...filter })}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Dashboard unavailable");
        setView((await response.json()) as DashboardView);
        setViewFilter(filter);
      } catch (error) {
        if ((error as DOMException).name !== "AbortError") console.error(error);
      } finally {
        if (!controller.signal.aborted) setRefreshing(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [filter]);

  const stale = refreshing || JSON.stringify(viewFilter) !== JSON.stringify(filter);
  return { filter, setFilter, view, refreshing, stale };
}

const SURFACE_TABS: Array<{ value: DashboardSurface | ""; label: string }> = [
  { value: "", label: "All" },
  { value: "assistants", label: "Assistants" },
  { value: "teammates", label: "Teammates" },
  { value: "internal", label: "Internal" },
];

/** Header, filters, range chip and the migration notice around a dashboard's cards. */
export function DashboardFrame({
  title,
  hint,
  filter,
  setFilter,
  refreshing,
  unavailable,
  assistants,
  exportRows,
  children,
}: {
  title: string;
  hint: string;
  filter: UsageDashboardFilter;
  setFilter: (filter: UsageDashboardFilter) => void;
  refreshing: boolean;
  unavailable: boolean;
  assistants: AssistantOption[];
  exportRows: () => Array<Record<string, string | number>>;
  children: ReactNode;
}) {
  const slideDirection = useSlidingDirection(filter.surface, SURFACE_TABS.map((tab) => tab.value));
  const assistantScoped = filter.surface === "" || filter.surface === "assistants";

  function exportCsv() {
    const rows = exportRows();
    const blob = new Blob([recordsToCsv(rows, rows.length ? undefined : ["day"])], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.toLowerCase()}-${filter.from}-${filter.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex min-h-full flex-col">
      <SlotPortal id={TOP_BAR_SLOT}>
        {refreshing && <span className="text-muted-foreground hidden text-sm xl:inline">Updating…</span>}
        <div className="flex items-center gap-2">
          <DateRangeDropdown
            from={filter.from}
            to={filter.to}
            onChange={(from, to) => setFilter({ ...filter, from, to })}
          />
          <Tabs
            value={filter.surface}
            onValueChange={(value) => {
              const surface = value as DashboardSurface | "";
              // An Assistant only narrows Assistant traffic; clear it elsewhere.
              setFilter({
                ...filter,
                surface,
                assistantId: surface === "" || surface === "assistants" ? filter.assistantId : "",
              });
            }}
          >
            <TabsList className="h-8">
              {SURFACE_TABS.map((tab) => (
                <TabsTrigger key={tab.label} value={tab.value} className="px-3">
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {assistantScoped && (
            <AssistantFilterDropdown
              assistants={assistants}
              value={filter.assistantId}
              onChange={(assistantId) => setFilter({ ...filter, assistantId })}
            />
          )}
          <Button variant="outline" className="h-8 shrink-0 rounded-lg px-2.5 lg:px-3" onClick={exportCsv}>
            <Download className="size-4" /> <span className="hidden lg:inline">Export CSV</span>
          </Button>
        </div>
      </SlotPortal>

      <SlotPortal id={INSIGHTS_RANGE_SLOT}>
        <InsightsRangeChip from={filter.from} to={filter.to} hint={hint} />
      </SlotPortal>

      {unavailable && (
        <div className="mx-4 mb-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm sm:mx-6">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <span>
            The dashboards&apos; database functions are not installed yet. This usually clears within minutes of
            a deploy, once its migration runs.
          </span>
        </div>
      )}

      <SlidingPanel activeKey={filter.surface} direction={slideDirection} sizing="flow" panelClassName="space-y-4 px-4 pt-5 pb-8 sm:px-6">{children}</SlidingPanel>
    </div>
  );
}

export function Section({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <AnalyticsCard title={title} description={description} className={className}>
      {children}
    </AnalyticsCard>
  );
}

/** A two-part rate as a donut plus its counts, or a plain "not measured" line when it has none. */
export function RateCard({
  title,
  description,
  good,
  bad,
  goodLabel,
  badLabel,
  detail,
  empty,
  loading,
  className,
  children,
  variant = "donut",
}: {
  title: string;
  description?: string;
  good: number;
  bad: number;
  goodLabel: string;
  badLabel: string;
  detail?: string;
  empty: string;
  loading: boolean;
  className?: string;
  children?: ReactNode;
  variant?: "donut" | "gauge" | "waffle";
}) {
  return (
    <Section title={title} description={description} className={className}>
      {loading ? (
        <Skeleton aria-label="Loading chart" className="h-44 w-full rounded-xl" />
      ) : good + bad === 0 ? (
        <EmptyState size="sm" title="No data in this range" description={empty} />
      ) : (
        <div className="space-y-4">
          <RateDonut good={good} bad={bad} goodLabel={goodLabel} badLabel={badLabel} title={title} loading={loading} variant={variant} />
          {detail && <p className="text-muted-foreground text-sm">{detail}</p>}
          {children}
        </div>
      )}
    </Section>
  );
}
