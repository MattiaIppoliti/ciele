"use client";

import { useRouter } from "next/navigation";
import type { PlatformInsightsReport, PlatformOrganizationInsights } from "@agent-hub/core";
import { AnalyticsCard } from "./analytics-card";
import { Table, type TableColumn } from "@/components/motion/table";
import { DashboardStatCards } from "@/components/insights/dashboard/dashboard-stat-cards";
import { DateRangeDropdown } from "@/components/insights/date-range-dropdown";
import { InsightsRangeChip } from "@/components/insights/insights-range-chip";
import { INSIGHTS_RANGE_SLOT, SlotPortal } from "@/components/shell/slot-portal";
import { formatEur } from "@/lib/insights/dashboard-view";
import { formatCount, formatShortDay } from "@/lib/format";
import type { StatSpec } from "@/lib/insights/dashboard-stats";

const columns: TableColumn<PlatformOrganizationInsights>[] = [
  { key: "name", header: "Organization", accessor: (row) => row.name, sortable: true },
  { key: "cost", header: "Estimated cost", accessor: (row) => row.estimatedCostEur, cell: (row) => formatEur(row.estimatedCostEur), align: "right", sortable: true },
  { key: "platform", header: "Platform cost", accessor: (row) => row.platformCostEur, cell: (row) => formatEur(row.platformCostEur), align: "right", sortable: true },
  { key: "calls", header: "Model calls", accessor: (row) => row.calls, align: "right", sortable: true },
  { key: "tokens", header: "Tokens", accessor: (row) => row.inputTokens + row.outputTokens, align: "right", sortable: true },
  { key: "crawl", header: "Crawl pages", accessor: (row) => row.crawlPages, align: "right", sortable: true },
  { key: "members", header: "Members", accessor: (row) => row.members, align: "right", sortable: true },
  { key: "assistants", header: "Assistants", accessor: (row) => row.assistants, align: "right", sortable: true },
  { key: "conversations", header: "Conversations", accessor: (row) => row.conversations, align: "right", sortable: true },
  { key: "errors", header: "Source errors", accessor: (row) => row.sourceErrors, align: "right", sortable: true },
];

export function PlatformInsightsDashboard({ report }: { report: PlatformInsightsReport }) {
  const router = useRouter();
  const total = (pick: (org: PlatformOrganizationInsights) => number) => report.organizations.reduce((sum, row) => sum + pick(row), 0);
  const base = { previous: null, goodWhen: "neutral", series: [], labels: [], caption: "Across all organizations" } satisfies Partial<StatSpec>;
  const specs: StatSpec[] = [
    { ...base, key: "cost", label: "Estimated cost", kind: "eur", value: total((row) => row.estimatedCostEur), series: report.daily.map((day) => day.estimatedCostEur), labels: report.daily.map((day) => formatShortDay(day.day)) },
    { ...base, key: "platform", label: "Platform-funded cost", kind: "eur", value: total((row) => row.platformCostEur) },
    { ...base, key: "calls", label: "Model calls", kind: "count", value: total((row) => row.calls), series: report.daily.map((day) => day.calls), labels: report.daily.map((day) => formatShortDay(day.day)) },
    { ...base, key: "orgs", label: "Organizations", kind: "count", value: report.organizations.length },
  ];
  return <div className="space-y-4 px-4 pt-5 pb-8 sm:px-6">
    <SlotPortal id={INSIGHTS_RANGE_SLOT}>
      <InsightsRangeChip {...report.range} hint="Usage and estimated costs for all organizations, including Ciele, over the selected UTC days." />
    </SlotPortal>
    <div className="flex flex-wrap items-center justify-between gap-3">

      <DateRangeDropdown {...report.range} onChange={(from, to) => {
        const params = new URLSearchParams(window.location.search);
        params.set("from", from);
        params.set("to", to);
        router.push(`/insights/admin?${params.toString()}`);
      }} />
    </div>
    <DashboardStatCards specs={specs} />
    <AnalyticsCard title="Organizations" description="Estimates, not invoices. Platform costs exclude customer keys and subscriptions. Entity counts are current.">
        <Table title="Organizations" noun="organization" data={report.organizations} columns={columns} getRowId={(row) => row.id}
          emptyState={<p className="text-muted-foreground text-sm">No organizations yet.</p>}
          />
        <p className="text-muted-foreground mt-3 text-xs">{formatCount(total((row) => row.inputTokens))} input tokens · {formatCount(total((row) => row.outputTokens))} output tokens</p>
    </AnalyticsCard>
  </div>;
}
