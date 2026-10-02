import {
  modelSelector,
  type EvaluationRun,
  type EvaluationResult,
  type UsageDashboard,
} from "@agent-hub/core";

type Totals = UsageDashboard["totals"];

/** Compare the same percentage measure, only when both periods measured it. */
export function rateComparisons(current: Totals, previous: Totals | null) {
  if (!previous) return [];
  return [
    {
      key: "success",
      label: "Reliability",
      start: previous.successRate,
      end: current.successRate,
    },
    {
      key: "accuracy",
      label: "Answer accuracy",
      start: previous.evalPassRate,
      end: current.evalPassRate,
    },
    {
      key: "autonomy",
      label: "Autonomy",
      start: previous.autonomyRate,
      end: current.autonomyRate,
    },
  ].flatMap((row) =>
    row.start === null || row.end === null
      ? []
      : [{ ...row, start: row.start * 100, end: row.end * 100 }],
  );
}

export function modelSpendTree(models: UsageDashboard["models"]) {
  const providers = [...new Set(models.map((model) => model.provider))];
  return {
    id: "spend",
    label: "Estimated model spend",
    children: providers.map((provider) => ({
      id: `provider:${provider}`,
      label: provider || "Unknown provider",
      children: models
        .filter((model) => model.provider === provider)
        .map((model) => ({
          id: JSON.stringify([provider, model.modelId]),
          label: model.modelId || "Unknown model",
          value: model.spendEur,
        })),
    })),
  };
}

/** Raw observations, including technical failures; never manufacture samples from percentiles. */
export function evaluationLatencies(
  run: Pick<EvaluationRun, "candidates" | "results">,
  labels: Record<string, string>,
) {
  return run.candidates
    .map((candidate) => {
      const id = modelSelector(candidate);
      const values = run.results
        .filter((result) => modelSelector(result.candidate) === id)
        .map((result) => result.latencyMs)
        .filter((value) => Number.isFinite(value) && value >= 0);
      return { id, label: labels[id] ?? candidate.modelId, values };
    })
    .filter((series) => series.values.length >= 2);
}

export function evaluationCandidateStats(results: EvaluationResult[]) {
  const count = results.length;
  const graded = results.filter((result) => result.accuracy !== null);
  return {
    accuracy: graded.length
      ? (100 * graded.filter((result) => result.accuracy).length) /
        graded.length
      : null,
    cost: count
      ? results.reduce((sum, result) => sum + result.costEur, 0) / count
      : null,
    tokens: count
      ? results.reduce(
          (sum, result) => sum + result.inputTokens + result.outputTokens,
          0,
        ) / count
      : null,
    latency: count
      ? results.reduce((sum, result) => sum + result.latencyMs, 0) / count
      : null,
    autonomy: results.some((result) => result.autonomous !== null)
      ? (100 * results.filter((result) => result.autonomous === true).length) /
        results.filter((result) => result.autonomous !== null).length
      : null,
    error: count
      ? (100 * results.filter((result) => result.error !== null).length) / count
      : null,
  };
}
