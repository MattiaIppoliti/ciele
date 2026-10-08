"use client";

import { ArrowRight, CheckCircle2, CircleAlert } from "lucide-react";
import { Button, Hint } from "@agent-hub/ui";
import { modelSelector, type EvaluationRun } from "@agent-hub/core";
import { Table, type TableColumn } from "@/components/motion/table";
import { TableActions } from "@/components/ui/table";

type Result = EvaluationRun["results"][number];

export function EvaluationResultsTable({ run, questions, selected, onSelect }: {
  run: EvaluationRun; questions: Record<string, string>; selected: string | null; onSelect: (id: string) => void;
}) {
  const columns: TableColumn<Result>[] = [
    { key: "question", header: "Question", accessor: r => questions[r.exampleId] ?? r.exampleId, width: "20rem", sortable: true },
    { key: "model", header: "Model", accessor: r => modelSelector(r.candidate), cell: r => r.candidate.modelId, filterLabel: "Model", filterOptions: run.candidates.map(c => ({ value: modelSelector(c), label: c.modelId })) },
    { key: "accuracy", header: "Accuracy", accessor: r => r.accuracy === null ? "ungraded" : r.accuracy ? "correct" : "incorrect", filterLabel: "Accuracy", filterAnyLabel: "All outcomes", filterOptions: [{ value: "correct", label: "Correct" }, { value: "incorrect", label: "Incorrect" }, { value: "ungraded", label: "Ungraded" }], cell: r => r.accuracy === null ? "—" : r.accuracy ? <CheckCircle2 aria-label="Correct" className="size-4 text-emerald-500" /> : <CircleAlert aria-label="Incorrect" className="size-4 text-amber-500" /> },
    { key: "flow", header: "Flow", accessor: r => r.flowName ?? r.flowId ?? "—", sortable: true },
    { key: "latency", header: "Latency", accessor: r => r.latencyMs, cell: r => `${r.latencyMs} ms`, sortable: true, align: "right" },
    { key: "tokens", header: "Tokens", accessor: r => r.inputTokens + r.outputTokens, sortable: true, align: "right" },
    { key: "cost", header: "Model cost", accessor: r => r.costEur, cell: r => `€${r.costEur.toFixed(4)}`, sortable: true, align: "right" },
    { key: "error", header: "Error", accessor: r => r.error ? "yes" : "no", cell: r => r.error ? <span className="text-destructive">Yes</span> : "—", filterLabel: "Error", filterOptions: [{ value: "yes", label: "With errors" }, { value: "no", label: "Without errors" }] },
    { key: "actions", header: "Actions", align: "right", width: "8rem", cell: r => <TableActions><Hint label="Inspect question"><Button variant="ghost" size="icon-sm" aria-label={`Inspect ${questions[r.exampleId] ?? r.exampleId}`} onClick={event => { event.stopPropagation(); onSelect(r.exampleId); }}><ArrowRight className="size-4" /></Button></Hint></TableActions> },
  ];
  return <Table title="Results by question" noun="result" data={run.results} columns={columns}
    getRowId={r => `${r.exampleId}-${modelSelector(r.candidate)}`}
    searchValue={r => `${questions[r.exampleId] ?? r.exampleId} ${r.candidate.modelId} ${r.flowName ?? r.flowId ?? ""} ${r.error ?? ""}`}
    onRowClick={r => onSelect(r.exampleId)} isRowSelected={r => r.exampleId === selected} emptyState="No question results yet." />;
}
