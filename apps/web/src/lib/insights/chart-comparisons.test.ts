import { describe, expect, it } from "vitest";
import { computeUsageDashboard, type EvaluationResult } from "@agent-hub/core";
import {
  evaluationCandidateStats,
  evaluationLatencies,
  modelSpendTree,
  rateComparisons,
} from "./chart-comparisons";

const empty = computeUsageDashboard(
  { usage: [], turns: [], verdicts: [], conversations: [] },
  {
    from: "2026-09-01",
    to: "2026-09-02",
    surface: "",
    assistantId: "",
  },
);
const first = { provider: "openai", modelId: "shared-id" } as const;
const second = { provider: "anthropic", modelId: "shared-id" } as const;
const result = (over: Partial<EvaluationResult> = {}): EvaluationResult => ({
  candidate: first,
  exampleId: "one",
  answer: "",
  flowId: null,
  flowName: null,
  sourceUrls: [],
  latencyMs: 10,
  inputTokens: 3,
  outputTokens: 2,
  costEur: 0.0003,
  accuracy: null,
  autonomous: null,
  error: null,
  ...over,
});

describe("analytics comparisons", () => {
  it("keeps real zero rates and leaves unmeasured rates out of the slope", () => {
    const current = {
      ...empty.totals,
      successRate: 0.8,
      evalPassRate: null,
      autonomyRate: 0,
    };
    const previous = {
      ...empty.totals,
      successRate: 0,
      evalPassRate: 0.7,
      autonomyRate: 0.5,
    };
    expect(rateComparisons(current, previous)).toEqual([
      { key: "success", label: "Reliability", start: 0, end: 80 },
      { key: "autonomy", label: "Autonomy", start: 50, end: 0 },
    ]);
    expect(rateComparisons(current, null)).toEqual([]);
  });

  it("keeps sub-cent spend and separates the same model ID across providers", () => {
    const tree = modelSpendTree(
      [first, second].map((candidate) => ({
        ...candidate,
        calls: 1,
        inputTokens: 3,
        outputTokens: 2,
        spendEur: 0.00003,
        share: 0.5,
      })),
    );
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0]!.children[0]!.id).not.toBe(
      tree.children[1]!.children[0]!.id,
    );
    expect(
      tree.children
        .flatMap((provider) => provider.children)
        .reduce((sum, model) => sum + model.value, 0),
    ).toBeCloseTo(0.00006, 8);
  });

  it("requires enough finite raw observations for each model's density, including failures", () => {
    const results = Array.from({ length: 20 }, (_, i) =>
      result({ latencyMs: i * 10, error: i === 19 ? "timeout" : null }),
    );
    const run = {
      candidates: [first, second],
      results: [
        ...results,
        result({ latencyMs: NaN }),
        result({ latencyMs: -5 }),
        result({ candidate: second }),
      ],
    };
    expect(
      evaluationLatencies(run, { "openai:shared-id": "First model" }),
    ).toEqual([
      {
        id: "openai:shared-id",
        label: "First model",
        values: results.map((r) => r.latencyMs),
      },
    ]);
  });

  it("does not turn a model without executions into perfect errors or free, instant answers", () => {
    expect(evaluationCandidateStats([])).toEqual({
      accuracy: null,
      cost: null,
      tokens: null,
      latency: null,
      autonomy: null,
      error: null,
    });
    const stats = evaluationCandidateStats([
      result({ accuracy: true, autonomous: true }),
      result({ accuracy: false, error: "timeout", autonomous: false }),
      result(),
    ]);
    expect(stats.accuracy).toBe(50);
    expect(stats.autonomy).toBe(50);
    expect(stats.error).toBeCloseTo(100 / 3);
    expect(stats.cost).toBeCloseTo(0.0003);
  });
});
