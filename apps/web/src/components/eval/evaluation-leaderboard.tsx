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
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="border-b px-5 py-4">
        <h2 className="font-medium">Leaderboard</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {run.examples.length} examples per model. Cost is the EUR estimate per 1,000 examples.
          {run.stage === "classifier" && flows.length > 0 &&
            ` Flow columns count correct examples out of ${
              new Set(flows.map((flow) => flow.examples)).size === 1
                ? `${flows[0]!.examples} each`
                : flows.map((flow) => `${flow.examples} (${flow.label})`).join(", ")
            }.`}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Model</th>
              {columns.map((column) => (
                <th key={column.head} className="whitespace-nowrap px-4 py-3 text-right font-medium">
                  {column.head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const key = modelSelector(row.candidate);
              return (
                <tr key={key} className="border-b last:border-0">
                  <td className={`whitespace-nowrap px-4 py-3 ${rowIndex === 0 && rows.length > 1 ? "font-semibold" : ""}`}>
                    {labels[key] ?? row.candidate.modelId}
                  </td>
                  {columns.map((column, index) => (
                    <td
                      key={column.head}
                      className={`whitespace-nowrap px-4 py-3 text-right ${bests[index] !== null && column.best?.(row) === bests[index] ? "font-semibold" : ""}`}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
