import { describe, expect, it } from "vitest";
import {
  EVALUATION_RUN_STALE_MS,
  evaluationLeaderboard,
  gradeEvaluation,
  settleStaleEvaluationRun,
  type EvaluationResult,
  type EvaluationRun,
  autoModelFromEvaluations,
} from "./evaluation";

const output = {
  answer: "Orders ship within 3 business days.",
  flowId: "shipping",
  flowName: "Shipping",
  sourceUrls: ["https://example.org/shipping"],
  error: null,
};

describe("evaluation reference grading", () => {
  it("marks an unlabelled example as ungraded, not wrong", () => {
    expect(gradeEvaluation("answer", {}, output)).toBeNull();
  });
  it("checks answer, flow and source requirements together", () => {
    const reference = {
      answer_contains: ["3 business days"],
      flow_id: "shipping",
      source_url_contains: ["/shipping"],
    };
    expect(gradeEvaluation("answer", reference, output)).toBe(true);
    expect(
      gradeEvaluation("answer", { ...reference, flow_id: "helpdesk" }, output),
    ).toBe(false);
  });
  it("uses only stage-relevant references", () => {
    const reference = {
      flow_id: "shipping",
      answer_contains: ["never present"],
      source_url_contains: ["never present"],
    };
    expect(gradeEvaluation("classifier", reference, output)).toBe(true);
    expect(gradeEvaluation("reranker", reference, output)).toBe(false);
  });
  it("keeps technical failures in error rate, not in unlabelled accuracy", () => {
    expect(
      gradeEvaluation("preflight", {}, { ...output, error: "timeout" }),
    ).toBeNull();
    expect(
      gradeEvaluation(
        "preflight",
        { flow_id: "shipping" },
        { ...output, error: "timeout" },
      ),
    ).toBe(false);
  });
});

describe("a run whose function stopped", () => {
  const updatedAt = "2026-09-28T10:00:00.000Z";
  const run = {
    id: "run-1",
    status: "running",
    error: null,
    updatedAt,
  } as EvaluationRun;
  const at = (ms: number) => new Date(Date.parse(updatedAt) + ms);

  it("stays running while the runner can still be writing", () => {
    expect(settleStaleEvaluationRun(run, at(EVALUATION_RUN_STALE_MS))).toBe(run);
  });

  it("reads as failed once no runner can still be alive", () => {
    const settled = settleStaleEvaluationRun(run, at(EVALUATION_RUN_STALE_MS + 1));
    expect(settled.status).toBe("failed");
    expect(settled.error).toMatch(/stopped before it finished/);
  });

  it("leaves a finished run alone however old it is", () => {
    const done = { ...run, status: "completed" } as EvaluationRun;
    expect(settleStaleEvaluationRun(done, at(10 * EVALUATION_RUN_STALE_MS))).toBe(done);
  });
});

describe("the run leaderboard", () => {
  const cheap = { provider: "openai", modelId: "cheap" } as const;
  const dear = { provider: "anthropic", modelId: "dear" } as const;
  const result = (
    exampleId: string,
    candidate: typeof cheap | typeof dear,
    over: Partial<EvaluationResult>,
  ): EvaluationResult => ({
    exampleId,
    candidate,
    answer: "",
    flowId: null,
    flowName: null,
    sourceUrls: [],
    latencyMs: 1000,
    inputTokens: 0,
    outputTokens: 0,
    costEur: 0,
    accuracy: true,
    autonomous: null,
    error: null,
    ...over,
  });
  const run = {
    stage: "classifier",
    candidates: [dear, cheap],
    examples: [
      { id: "a", inputs: { question: "hi" }, reference_outputs: { flow_id: "basic" } },
      { id: "b", inputs: { question: "hello" }, reference_outputs: { flow_id: "basic" } },
      { id: "c", inputs: { question: "a human" }, reference_outputs: { flow_name: "Human help" } },
    ],
    results: [
      result("a", dear, { costEur: 0.004, latencyMs: 3000, flowId: "basic", flowName: "Basic" }),
      result("b", dear, { costEur: 0.004, latencyMs: 1000 }),
      result("c", dear, { costEur: 0.004, latencyMs: 2000 }),
      result("a", cheap, { costEur: 0.0001, latencyMs: 500 }),
      result("b", cheap, { costEur: 0.0001, latencyMs: 9000, accuracy: false, error: "timeout" }),
      result("c", cheap, { costEur: 0.0001, latencyMs: 700 }),
    ],
  } as unknown as EvaluationRun;

  it("groups the reference Flows and counts correct examples per model", () => {
    const { flows, rows } = evaluationLeaderboard(run);
    expect(flows).toEqual([
      { key: "basic", label: "Basic", examples: 2 },
      { key: "human help", label: "Human help", examples: 1 },
    ]);
    expect(rows.map((row) => row.candidate.modelId)).toEqual(["dear", "cheap"]);
    expect(rows[0]!.flowCorrect).toEqual([2, 1]);
    expect(rows[1]!.flowCorrect).toEqual([1, 1]);
  });

  it("prices per 1,000 examples and leaves failed calls out of latency", () => {
    const [dearRow, cheapRow] = evaluationLeaderboard(run).rows;
    expect(dearRow!.eurPer1000).toBeCloseTo(4);
    expect(dearRow!.medianMs).toBe(2000);
    expect(dearRow!.p95Ms).toBe(3000);
    expect(cheapRow!.accuracy).toBeCloseTo(2 / 3);
    expect(cheapRow!.errorRate).toBeCloseTo(1 / 3);
    expect(cheapRow!.medianMs).toBe(500);
    expect(cheapRow!.p95Ms).toBe(700);
    expect(cheapRow!.autonomy).toBeNull();
  });

  it("breaks an accuracy tie on cost", () => {
    const tied = {
      ...run,
      results: run.results.map((item) => ({ ...item, accuracy: true, error: null })),
    };
    expect(evaluationLeaderboard(tied).rows.map((row) => row.candidate.modelId)).toEqual([
      "cheap",
      "dear",
    ]);
  });
});

describe("the model Auto asks", () => {
  const opus = { provider: "anthropic" as const, modelId: "claude-opus-4-8" };
  const gpt = { provider: "openai" as const, modelId: "gpt-5.1" };
  const result = (candidate: typeof opus | typeof gpt, accuracy: boolean | null) => ({
    exampleId: "e1",
    candidate,
    answer: "",
    flowId: null,
    flowName: null,
    sourceUrls: [],
    latencyMs: 100,
    inputTokens: 1,
    outputTokens: 1,
    costEur: 0.001,
    accuracy,
    autonomous: null,
    error: null,
  });
  const run = (over: Partial<EvaluationRun>): EvaluationRun =>
    ({
      id: "r",
      status: "completed",
      stage: "answer",
      candidates: [opus, gpt],
      examples: [{ id: "e1", inputs: { question: "q" }, reference_outputs: {} }],
      results: [result(opus, false), result(gpt, true)],
      updatedAt: "2026-09-28T10:00:00.000Z",
      ...over,
    }) as EvaluationRun;
  const anything = () => true;

  it("takes the newest answer-stage Eval's most accurate model", () => {
    expect(autoModelFromEvaluations([run({})], anything)).toEqual(gpt);
    const newer = run({
      updatedAt: "2026-09-29T10:00:00.000Z",
      results: [result(opus, true), result(gpt, false)],
    });
    expect(autoModelFromEvaluations([run({}), newer], anything)).toEqual(opus);
  });

  it("skips a winner nobody can ask, for the next one down", () => {
    expect(autoModelFromEvaluations([run({})], (c) => c.provider !== "openai")).toEqual(opus);
  });

  it("ignores other stages, unfinished runs and runs with nothing graded", () => {
    expect(autoModelFromEvaluations([run({ stage: "classifier" })], anything)).toBeNull();
    expect(autoModelFromEvaluations([run({ status: "running" })], anything)).toBeNull();
    expect(
      autoModelFromEvaluations([run({ results: [result(opus, null), result(gpt, null)] })], anything)
    ).toBeNull();
    expect(autoModelFromEvaluations([], anything)).toBeNull();
  });
});
