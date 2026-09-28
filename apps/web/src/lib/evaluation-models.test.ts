import { describe, expect, it } from "vitest";
import { allEvaluationModels, evaluationModelsForStage, type EvaluationModelOption } from "./evaluation-models";

describe("evaluation model choices", () => {
  const models: EvaluationModelOption[] = [
    { provider: "google", modelId: "gemini-3.5-flash", label: "Gemini", providerName: "Google" },
    { provider: "openai", modelId: "gpt-5.4-mini", label: "GPT", providerName: "OpenAI" },
    { provider: "openai_compatible", modelId: "llama", label: "Llama", providerName: "OpenAI-compatible" },
    { provider: "typesafe", modelId: "typesafe-ai/jev", label: "Jev", providerName: "Typesafe AI" },
    { provider: "voyage", modelId: "voyage/rerank-2.5", label: "Rerank", providerName: "Voyage" },
  ];

  it("only offers models that can execute the selected stage", () => {
    expect(evaluationModelsForStage(models, "reranker", "google").map((model) => model.provider)).toEqual(["voyage"]);
    expect(evaluationModelsForStage(models, "preflight", "google").map((model) => model.provider)).toEqual(["google", "openai", "typesafe"]);
    expect(evaluationModelsForStage(models, "answer", "google").map((model) => model.provider)).toEqual(["google", "openai", "openai_compatible"]);
    expect(evaluationModelsForStage(models, "fallback", "google").map((model) => model.provider)).toEqual(["openai", "openai_compatible"]);
  });

  it("includes platform-added chat models without duplicating built-in IDs", () => {
    const extra = {
      provider: "google" as const,
      modelId: "gemini-custom",
      label: "Gemini Custom",
      inputEurPerMillion: 1,
      outputEurPerMillion: 2,
      addedBy: "owner@test",
      createdAt: "2026-09-28T00:00:00.000Z",
    };
    const models = allEvaluationModels([], [
      extra,
      { ...extra, modelId: "gemini-3.5-flash" },
    ]);
    expect(models.filter((model) => model.modelId === "gemini-custom")).toEqual([
      { provider: "google", modelId: "gemini-custom", label: "Gemini Custom", providerName: "Google", platformAdded: true, inputEurPerMillion: 1, outputEurPerMillion: 2 },
    ]);
    expect(models.filter((model) => model.modelId === "gemini-3.5-flash")).toHaveLength(1);
  });
});
