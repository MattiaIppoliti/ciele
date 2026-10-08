"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button, Hint } from "@agent-hub/ui";
import { EVALUATION_STAGES, type EvaluationDataset, type EvaluationRun, type EvaluationStage } from "@agent-hub/core";
import { Table, type TableColumn } from "@/components/motion/table";
import { TableActions } from "@/components/ui/table";
import { TableFilter } from "@/components/ui/table-filters";
import { StatusBadge } from "@/components/spaceui/status-badge";

export type RunFilters = { stage: EvaluationStage | ""; assistant: string; dataset: string };
const stageLabel = (stage: string) => stage === "preflight" ? "Pre-flight" : stage.charAt(0).toUpperCase() + stage.slice(1);

export function EvaluationRunsTable({ runs, assistants, datasets, page, pageSize, total, filters }: {
  runs: EvaluationRun[]; assistants: { id: string; title: string }[]; datasets: EvaluationDataset[];
  page: number; pageSize: number; total: number; filters: RunFilters;
}) {
  const router = useRouter();
  function navigate(patch: Partial<RunFilters> & { page?: number; pageSize?: number }) {
    const next = { ...filters, page: 1, pageSize, ...patch };
    const params = new URLSearchParams();
    if (next.page > 1) params.set("page", String(next.page));
    if (next.pageSize !== 25) params.set("size", String(next.pageSize));
    for (const key of ["stage", "assistant", "dataset"] as const) if (next[key]) params.set(key, next[key]);
    router.push(`/eval${params.size ? `?${params}` : ""}`);
  }
  const columns: TableColumn<EvaluationRun>[] = [
    { key: "date", header: "Date", accessor: r => r.createdAt, cell: r => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(r.createdAt)) },
    { key: "assistant", header: "Assistant", accessor: r => assistants.find(a => a.id === r.assistantId)?.title ?? r.assistantName },
    { key: "dataset", header: "Dataset", accessor: r => datasets.find(d => d.id === r.datasetId)?.name ?? r.datasetName },
    { key: "stage", header: "Stage", accessor: r => stageLabel(r.stage) },
    { key: "models", header: "Models", accessor: r => r.candidates.length, align: "right" },
    { key: "accuracy", header: "Accuracy", cell: r => {
      const graded = r.results.filter(result => result.accuracy !== null);
      return graded.length ? `${Math.round(100 * graded.filter(result => result.accuracy).length / graded.length)}%` : "—";
    } },
    { key: "cost", header: "Model cost", cell: r => `€${r.results.reduce((sum, result) => sum + result.costEur, 0).toFixed(4)}`, align: "right" },
    { key: "status", header: "Status", cell: r => <StatusBadge status={r.status === "completed" ? "online" : r.status === "failed" ? "error" : r.status === "running" ? "info" : "away"} animated={r.status === "running"} primaryText={r.status} /> },
    { key: "actions", header: "Actions", align: "right", width: "8rem", cell: r => <TableActions><Hint label="Open run"><Button render={<Link href={`/eval/${r.id}`} />} nativeButton={false} variant="ghost" size="icon-sm" aria-label={`Open run ${r.id}`}><ArrowRight className="size-4" /></Button></Hint></TableActions> },
  ];
  return <Table title="Recent runs" noun="run" data={runs} columns={columns} getRowId={r => r.id}
    onRowClick={r => router.push(`/eval/${r.id}`)} searchable={false}
    filters={<>
      <TableFilter label="Stage" anyLabel="All stages" value={filters.stage} options={EVALUATION_STAGES.map(value => ({ value, label: stageLabel(value) }))} onChange={stage => navigate({ stage: stage as EvaluationStage | "" })} />
      <TableFilter label="Assistant" anyLabel="All assistants" value={filters.assistant} options={assistants.map(a => ({ value: a.id, label: a.title }))} onChange={assistant => navigate({ assistant })} />
      <TableFilter label="Dataset" anyLabel="All datasets" value={filters.dataset} options={datasets.map(d => ({ value: d.id, label: d.name }))} onChange={dataset => navigate({ dataset })} />
    </>}
    pagination={{ total, page, pageSize, noun: "run", onPageChange: page => navigate({ page }), onPageSizeChange: pageSize => navigate({ pageSize }) }}
    emptyState="No matching runs. Upload a dataset and start a comparison, or clear the filters." />;
}
