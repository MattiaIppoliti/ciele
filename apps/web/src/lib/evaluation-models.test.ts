import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderConnection } from "@agent-hub/core";
import {
  allEvaluationModels,
  availableEvaluationModels,
  evaluationModelsForStage,
  type EvaluationModelOption,
} from "./evaluation-models";

describe("evaluation model availability", () => {
  afterEach(() => vi.unstubAllEnvs());

  // Google on the platform key: a direct route, as an Organization key would be.
  const connections: ProviderConnection[] = [];
  const platformModel = {
    provider: "openai" as const,
    modelId: "gpt-6-luna",
    label: "GPT-6 Luna",
    inputEurPerMillion: 0.1,
    outputEurPerMillion: 0.5,
    addedBy: "owner@test",
    createdAt: "2026-09-28T00:00:00.000Z",
  };

  it("offers a chat model that only AI Gateway serves", () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "google");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("AI_GATEWAY_API_KEY", "gw");
    const models = availableEvaluationModels(connections, true, [platformModel]);
    const pick = (modelId: string) => models.find((model) => model.modelId === modelId);
    expect(pick("gemini-3.5-flash")).toBeDefined();
    expect(pick("claude-sonnet-5")).toBeDefined();
    expect(pick("gpt-6-luna")).toBeDefined();
    // The Gateway lists no plain GPT-5.1, so it stays out.
    expect(pick("gpt-5.1")).toBeUndefined();
  });

  it("keeps a provider without a key or a Gateway out", () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "google");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    const models = availableEvaluationModels(connections, false, [platformModel]);
    expect(models.map((model) => model.provider)).toEqual(["google", "google", "google"]);
  });

  it("offers Gateway-only models in the pre-flight too, through the adapter", () => {
    const models: EvaluationModelOption[] = [
      { provider: "google", modelId: "gemini-3.5-flash", label: "Gemini", providerName: "Google" },
      { provider: "openai", modelId: "gpt-6-luna", label: "Luna", providerName: "OpenAI" },
      { provider: "typesafe", modelId: "typesafe-ai/jev", label: "Jev", providerName: "Typesafe AI" },
    ];
    expect(evaluationModelsForStage(models, "preflight", "google").map((model) => model.modelId)).toEqual([
      "gemini-3.5-flash",
      "gpt-6-luna",
      "typesafe-ai/jev",
    ]);
  });
});

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
