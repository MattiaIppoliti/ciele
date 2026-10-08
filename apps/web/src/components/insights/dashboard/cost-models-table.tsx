"use client";

import type { UsageDashboard } from "@agent-hub/core";
import { Table, type TableColumn } from "@/components/motion/table";
import { formatCount, formatPercent } from "@/lib/format";
import { formatEur } from "@/lib/insights/dashboard-view";

type ModelRow = UsageDashboard["models"][number];

export default function CostModelsTable({ models }: { models: ModelRow[] }) {
  const columns: TableColumn<ModelRow>[] = [
    { key: "model", header: "Model", accessor: r => r.modelId || "unknown", sortable: true },
    { key: "provider", header: "Provider", accessor: r => r.provider || "unknown", filterLabel: "Provider", filterOptions: [...new Set(models.map(r => r.provider || "unknown"))].sort().map(value => ({ value, label: value })) },
    { key: "spend", header: "Estimated spend", accessor: r => r.spendEur, cell: r => formatEur(r.spendEur), sortable: true, align: "right" },
    { key: "calls", header: "Calls", accessor: r => r.calls, cell: r => formatCount(r.calls), sortable: true, align: "right" },
    { key: "input", header: "Input tokens", accessor: r => r.inputTokens, cell: r => formatCount(r.inputTokens), sortable: true, align: "right" },
    { key: "output", header: "Output tokens", accessor: r => r.outputTokens, cell: r => formatCount(r.outputTokens), sortable: true, align: "right" },
    { key: "share", header: "Share of spend", accessor: r => r.share, sortable: true, cell: r => <div className="flex items-center gap-2">
      <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full"><div className="h-full rounded-full bg-chart-1" style={{ width: `${r.share * 100}%` }} /></div>
      <span className="text-muted-foreground w-9 text-right text-xs tabular-nums">{formatPercent(Math.round(r.share * 100))}</span>
    </div> },
  ];
  return <Table noun="model" data={models} columns={columns} getRowId={r => `${r.provider}/${r.modelId}`} emptyState="No model calls in this range." />;
}
