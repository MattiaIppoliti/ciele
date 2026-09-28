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
