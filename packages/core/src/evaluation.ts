import type { Provider, UsageProvider } from "./types";

/** Versioned upload contract; reference outputs are optional but required for accuracy. */
export interface EvaluationExample {
  id: string;
  inputs: {
    question: string;
    launch_url?: string;
    history?: Array<{ role: "user" | "assistant"; text: string }>;
    memory?: string[];
  };
  reference_outputs: {
    answer_contains?: string[];
    flow_id?: string;
    flow_name?: string;
    source_url_contains?: string[];
  };
}

/**
 * The stages a run can compare, in the order the console lists them. The SQL
 * `check` on `evaluation_runs.stage` is the one other copy.
 */
export const EVALUATION_STAGES = [
  "answer",
  "classifier",
  "orchestration",
  "fallback",
  "preflight",
  "reranker",
] as const;

export type EvaluationStage = (typeof EVALUATION_STAGES)[number];

export interface EvaluationCandidate {
  provider: UsageProvider;
  modelId: string;
}

/** Extra chat model offered in Eval by the Ciele platform owner. */
export interface PlatformEvalModel {
  /** Verified server-side against the provider catalog; absent on legacy rows. */
  contextWindow?: number | null;
  provider: Exclude<Provider, "openai_compatible">;
  modelId: string;
  label: string;
  inputEurPerMillion: number;
  outputEurPerMillion: number;
  addedBy: string;
  createdAt: string;
}

export interface EvaluationDataset {
  id: string;
  organizationId: string;
  name: string;
  examples: EvaluationExample[];
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationResult {
  exampleId: string;
  candidate: EvaluationCandidate;
  answer: string;
  flowId: string | null;
  flowName: string | null;
  sourceUrls: string[];
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costEur: number;
  accuracy: boolean | null;
  autonomous: boolean | null;
  error: string | null;
}

export interface EvaluationRun {
  id: string;
  organizationId: string;
  assistantId: string;
  assistantName: string;
  assistantModel: EvaluationCandidate;
  datasetId: string;
  datasetName: string;
  examples: EvaluationExample[];
  stage: EvaluationStage;
  candidates: EvaluationCandidate[];
  status: "running" | "completed" | "failed";
  results: EvaluationResult[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * How long a `running` run may go without a write before no runner can still
 * be alive. The runner writes after every example and its function is capped
 * at five minutes, so six minutes of silence means the function was killed.
 */
export const EVALUATION_RUN_STALE_MS = 6 * 60_000;

/**
 * A run whose function was killed mid-way is never written again, so its row
 * says `running` forever. Read it as failed instead; nothing needs to sweep it.
 */
export function settleStaleEvaluationRun(
  run: EvaluationRun,
  now: Date,
): EvaluationRun {
  if (run.status !== "running") return run;
  if (now.getTime() - Date.parse(run.updatedAt) <= EVALUATION_RUN_STALE_MS)
    return run;
  return {
    ...run,
    status: "failed",
    error:
      run.error ??
      "The run stopped before it finished. Results saved before it stopped are kept.",
  };
}

/** A reference assertion is graded only on the stage that can produce it. */
export function gradeEvaluation(
  stage: EvaluationStage,
  reference: EvaluationExample["reference_outputs"],
  output: Pick<
    EvaluationResult,
    "answer" | "flowId" | "flowName" | "sourceUrls" | "error"
  >,
): boolean | null {
  const checks: boolean[] = [];
  if (stage !== "reranker" && reference.flow_id)
    checks.push(output.flowId === reference.flow_id);
  if (stage !== "reranker" && reference.flow_name)
    checks.push(
      output.flowName?.toLocaleLowerCase() ===
        reference.flow_name.toLocaleLowerCase(),
    );
  if (
    ["answer", "orchestration", "fallback"].includes(stage) &&
    reference.answer_contains?.length
  ) {
    checks.push(
      reference.answer_contains.every((fragment) =>
        output.answer
          .toLocaleLowerCase()
          .includes(fragment.toLocaleLowerCase()),
      ),
    );
  }
  if (
    !["classifier", "preflight"].includes(stage) &&
    reference.source_url_contains?.length
  ) {
    checks.push(
      reference.source_url_contains.every((fragment) =>
        output.sourceUrls.some((url) =>
          url.toLocaleLowerCase().includes(fragment.toLocaleLowerCase()),
        ),
      ),
    );
  }
  if (!checks.length) return null;
  return !output.error && checks.every(Boolean);
}

/** One reference Flow of the dataset, with how many examples expect it. */
export interface EvaluationLeaderboardFlow {
  key: string;
  label: string;
  examples: number;
}

/** One candidate's summary line; ratios are 0..1, null when not measured. */
export interface EvaluationLeaderboardRow {
  candidate: EvaluationCandidate;
  accuracy: number | null;
  autonomy: number | null;
  errorRate: number;
  eurPer1000: number;
  medianMs: number | null;
  p95Ms: number | null;
  /** Correct examples per Flow, aligned with `flows`. */
  flowCorrect: number[];
}

function referenceFlowKey(
  reference: EvaluationExample["reference_outputs"],
): string | null {
  return reference.flow_id ?? reference.flow_name?.toLocaleLowerCase() ?? null;
}

/** Nearest-rank percentile over an ascending list. */
function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}

function ratio(values: Array<boolean | null>): number | null {
  const measured = values.filter((value) => value !== null);
  return measured.length
    ? measured.filter(Boolean).length / measured.length
    : null;
}

/**
 * The run's leaderboard: one row per candidate, most accurate first and
 * cheapest first among equals. Latency percentiles leave out executions that
 * errored, because how fast a call fails says nothing about the model.
 */
export function evaluationLeaderboard(run: EvaluationRun): {
  flows: EvaluationLeaderboardFlow[];
  rows: EvaluationLeaderboardRow[];
} {
  const flows = new Map<string, EvaluationLeaderboardFlow>();
  const flowOf = new Map<string, string>();
  for (const example of run.examples) {
    const key = referenceFlowKey(example.reference_outputs);
    if (!key) continue;
    flowOf.set(example.id, key);
    const flow = flows.get(key);
    if (flow) flow.examples += 1;
    else
      flows.set(key, {
        key,
        label:
          example.reference_outputs.flow_name ??
          run.results.find((result) => result.flowId === key)?.flowName ??
          key,
        examples: 1,
      });
  }
  const flowList = [...flows.values()];
  const key = (candidate: EvaluationCandidate) =>
    `${candidate.provider}:${candidate.modelId}`;

  const rows = run.candidates.map((candidate): EvaluationLeaderboardRow => {
    const results = run.results.filter(
      (result) => key(result.candidate) === key(candidate),
    );
    const latencies = results
      .filter((result) => !result.error)
      .map((result) => result.latencyMs)
      .sort((a, b) => a - b);
    const cost = results.reduce((sum, result) => sum + result.costEur, 0);
    return {
      candidate,
      accuracy: ratio(results.map((result) => result.accuracy)),
      autonomy: ratio(results.map((result) => result.autonomous)),
      errorRate: results.length
        ? results.filter((result) => result.error !== null).length /
          results.length
        : 0,
      eurPer1000: results.length ? (1000 * cost) / results.length : 0,
      medianMs: percentile(latencies, 0.5),
      p95Ms: percentile(latencies, 0.95),
      flowCorrect: flowList.map(
        (flow) =>
          results.filter(
            (result) =>
              result.accuracy === true &&
              flowOf.get(result.exampleId) === flow.key,
          ).length,
      ),
    };
  });
  rows.sort(
    (a, b) =>
      (b.accuracy ?? -1) - (a.accuracy ?? -1) || a.eurPer1000 - b.eurPer1000,
  );
  return { flows: flowList, rows };
}

/**
 * What "Auto" asks: the best model of the newest completed Eval on the
 * `answer` stage, which is the stage a chat turn is, taken from the
 * leaderboard's own order (most accurate first, cheapest among equals). A
 * candidate the caller cannot ask right now (no connection serves it, or it is
 * outside the chat's allow-list) is skipped for the next one down, and a run
 * with no graded answer ranks nothing. Null when no Eval has ranked an askable
 * model, which the caller reads as "use the configured model".
 */
export function autoModelFromEvaluations(
  runs: readonly EvaluationRun[],
  askable: (candidate: EvaluationCandidate) => boolean
): EvaluationCandidate | null {
  const newestFirst = runs
    .filter((run) => run.status === "completed" && run.stage === "answer")
    .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
  for (const run of newestFirst) {
    const best = evaluationLeaderboard(run).rows.find(
      (row) => row.accuracy !== null && askable(row.candidate)
    );
    if (best) return best.candidate;
  }
  return null;
}

/** Quality first; fewer errors, lower cost and latency break ties. Never invent a grade. */
export function recommendedEvaluationModel(
  run: EvaluationRun | null,
  assistantId: string,
  stage: EvaluationStage,
  available: EvaluationCandidate[],
): EvaluationLeaderboardRow | null {
  if (!run || run.status !== "completed" || run.assistantId !== assistantId || run.stage !== stage) return null;
  return evaluationLeaderboard(run).rows
    .filter(row => row.accuracy !== null && row.errorRate < 1 && run.results.filter(result => result.candidate.provider === row.candidate.provider && result.candidate.modelId === row.candidate.modelId).length === run.examples.length && available.some(model => model.provider === row.candidate.provider && model.modelId === row.candidate.modelId))
    .sort((a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1) || a.errorRate - b.errorRate || a.eurPer1000 - b.eurPer1000 || (a.medianMs ?? Infinity) - (b.medianMs ?? Infinity))[0] ?? null;
}
