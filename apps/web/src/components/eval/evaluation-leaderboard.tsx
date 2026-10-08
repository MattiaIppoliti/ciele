"use client";

import { Table, type TableColumn } from "@/components/motion/table";

import { RollingNumber } from "@/components/motion/rolling-number";
import {
  evaluationLeaderboard,
  modelSelector,
  type EvaluationLeaderboardRow,
  type EvaluationRun,
} from "@agent-hub/core";

const percent = (value: number | null) =>
  value === null ? "—" : `${Math.round(value * 100)}%`;
const seconds = (ms: number | null) =>
  ms === null ? "—" : `${(ms / 1000).toFixed(1)} s`;

type Column = {
  head: string;
  cell: (row: EvaluationLeaderboardRow) => string;
  /** Lower is better; the best value is set in bold when models differ. */
  best?: (row: EvaluationLeaderboardRow) => number | null;
};

/**
 * One line per model, most accurate first. Columns follow the data rather
 * than a per-stage list: Autonomy only where the stage measures it, Errors
 * only when a model failed, and one column per reference Flow on the
 * Classifier stage, where the Flow is the whole answer.
 */
export function EvaluationLeaderboard({
  run,
  labels,
}: {
  run: EvaluationRun;
  labels: Record<string, string>;
}) {
  const { flows, rows } = evaluationLeaderboard(run);
  if (!rows.length) return null;
  const columns: Column[] = [
    { head: "Accuracy", cell: (row) => percent(row.accuracy) },
    ...(rows.some((row) => row.autonomy !== null)
      ? [{ head: "Autonomy", cell: (row: EvaluationLeaderboardRow) => percent(row.autonomy) }]
      : []),
    ...(rows.some((row) => row.errorRate > 0)
      ? [{ head: "Errors", cell: (row: EvaluationLeaderboardRow) => percent(row.errorRate) }]
      : []),
    {
      head: "€ / 1,000",
      cell: (row) => row.eurPer1000.toFixed(2),
      best: (row) => row.eurPer1000,
    },
    { head: "Median", cell: (row) => seconds(row.medianMs), best: (row) => row.medianMs },
    { head: "p95", cell: (row) => seconds(row.p95Ms) },
    ...(run.stage === "classifier"
      ? flows.map((flow, index) => ({
          head: flow.label,
          cell: (row: EvaluationLeaderboardRow) => `${row.flowCorrect[index]}`,
        }))
      : []),
  ];
  const bestOf = (column: Column) => {
    if (!column.best || rows.length < 2) return null;
    const values = rows.map(column.best).filter((value) => value !== null);
    return values.length ? Math.min(...values) : null;
  };
  const bests = columns.map(bestOf);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-medium">Leaderboard</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          <RollingNumber value={run.examples.length} /> examples per model. Cost is the EUR estimate per 1,000 examples.
          {run.stage === "classifier" && flows.length > 0 &&
            ` Flow columns count correct examples out of ${
              new Set(flows.map((flow) => flow.examples)).size === 1
                ? `${flows[0]!.examples} each`
                : flows.map((flow) => `${flow.examples} (${flow.label})`).join(", ")
            }.`}
        </p>
      </div>
      <Table title="Leaderboard" noun="model" data={rows} getRowId={row => modelSelector(row.candidate)}
        columns={[
          { key: "model", header: "Model", accessor: row => labels[modelSelector(row.candidate)] ?? row.candidate.modelId,
            cell: row => <span className={row === rows[0] && rows.length > 1 ? "font-semibold" : undefined}>{labels[modelSelector(row.candidate)] ?? row.candidate.modelId}</span> },
          { key: "provider", header: "Provider", accessor: row => row.candidate.provider, filterLabel: "Provider",
            filterOptions: [...new Set(rows.map(row => row.candidate.provider))].map(value => ({ value, label: value })) },
          ...columns.map((column, index): TableColumn<EvaluationLeaderboardRow> => ({ key: `metric-${index}`, header: column.head, align: "right",
            accessor: column.cell, cell: row => <span className={bests[index] !== null && column.best?.(row) === bests[index] ? "font-semibold" : undefined}>{column.cell(row)}</span> })),
        ]} emptyState="No evaluated models yet." />
    </section>
  );
}
