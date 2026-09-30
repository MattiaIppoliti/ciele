import { describe, expect, it } from "vitest";
import { recommendedEvaluationModel, type EvaluationCandidate, type EvaluationResult, type EvaluationRun } from "./evaluation";
const a: EvaluationCandidate = { provider: "google", modelId: "a" };
const b: EvaluationCandidate = { provider: "openai", modelId: "b" };
function result(candidate: EvaluationCandidate, patch: Partial<EvaluationResult> = {}): EvaluationResult {
  return { candidate, exampleId: "1", answer: "ok", flowId: null, flowName: null, sourceUrls: [], latencyMs: 100, inputTokens: 0, outputTokens: 0, costEur: 0.001, accuracy: true, autonomous: true, error: null, ...patch };
}
function run(patch: Partial<EvaluationRun> = {}): EvaluationRun {
  return { id: "run", organizationId: "org", assistantId: "assistant", assistantName: "Assistant", assistantModel: a, datasetId: "data", datasetName: "Data", examples: [{ id: "1", inputs: { question: "test" }, reference_outputs: { answer_contains: ["ok"] } }], stage: "answer", candidates: [a,b], status: "completed", results: [result(a), result(b, { accuracy: false })], error: null, createdAt: "2026-09-30", updatedAt: "2026-09-30", ...patch };
}
const recommend = (value: EvaluationRun | null, available = [a,b]) => recommendedEvaluationModel(value, "assistant", "answer", available);
describe("Eval default recommendation", () => {
  it("scopes evidence to the Assistant and stage and only completed runs", () => {
    expect(recommend(run())?.candidate).toEqual(a);
    for (const value of [null, run({ assistantId: "other" }), run({ stage: "classifier" }), run({ status: "running" })]) expect(recommend(value)).toBeNull();
  });
  it("never suggests unavailable, ungraded, failed or incomplete candidates", () => {
    expect(recommend(run(), [b])?.candidate).toEqual(b);
    expect(recommend(run({ results: [result(a, { accuracy: null }), result(b, { accuracy: null })] }))).toBeNull();
    expect(recommend(run({ results: [result(a, { error: "timeout", accuracy: false })] }))).toBeNull();
    expect(recommend(run({ results: [] }))).toBeNull();
  });
  it("breaks quality ties by error rate, then cost, then latency", () => {
    expect(recommend(run({ results: [result(a), result(b, { costEur: 0.0001 })] }))?.candidate).toEqual(b);
    expect(recommend(run({ results: [result(a), result(b, { latencyMs: 50 })] }))?.candidate).toEqual(b);
  });
});
