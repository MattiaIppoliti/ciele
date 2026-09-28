import { MODEL_CATALOG, PROVIDER_NAMES } from "@agent-hub/agent/client";
import { availableModelSources } from "@agent-hub/agent";
import { modelSelector } from "@agent-hub/core";
import type {
  EvaluationCandidate,
  EvaluationStage,
  PlatformEvalModel,
  Provider,
  ProviderConnection,
} from "@agent-hub/core";

export interface EvaluationModelOption extends EvaluationCandidate {
  label: string;
  providerName: string;
  platformAdded?: boolean;
  inputEurPerMillion?: number;
  outputEurPerMillion?: number;
}

/** The platform catalog plus the active compatible endpoint's own model. */
export function allEvaluationModels(
  connections: ProviderConnection[],
  extraModels: PlatformEvalModel[] = [],
): EvaluationModelOption[] {
  const chatModels: EvaluationModelOption[] = (Object.keys(MODEL_CATALOG) as Provider[])
    .flatMap((provider) =>
      MODEL_CATALOG[provider].map((model) => ({
        provider,
        modelId: model.id,
        label: model.label,
        providerName: PROVIDER_NAMES[provider],
      })),
    );

  const connection = connections.find(
    (item) =>
      item.provider === "openai_compatible" &&
      item.type === "api_key" &&
      item.config.kind === "openai_compatible",
  );
  const compatibleModelId =
    connection?.config.kind === "openai_compatible"
      ? connection.config.chatModel
      : process.env.OPENAI_COMPATIBLE_CHAT_MODEL;
  if (compatibleModelId) {
    chatModels.push({
      provider: "openai_compatible",
      modelId: compatibleModelId,
      label: compatibleModelId,
      providerName: "OpenAI-compatible",
    });
  }
  chatModels.push(
    { provider: "typesafe", modelId: "typesafe-ai/jev", label: "Jev", providerName: "Typesafe AI" },
    { provider: "voyage", modelId: "voyage/rerank-2.5", label: "Rerank 2.5", providerName: "Voyage" },
    { provider: "voyage", modelId: "voyage/rerank-2.5-lite", label: "Rerank 2.5 Lite", providerName: "Voyage" },
  );
  const seen = new Set(chatModels.map(modelSelector));
  for (const model of extraModels) {
    const key = modelSelector(model);
    if (seen.has(key)) continue;
    seen.add(key);
    chatModels.push({
      provider: model.provider,
      modelId: model.modelId,
      label: model.label,
      providerName: PROVIDER_NAMES[model.provider],
      platformAdded: true,
      inputEurPerMillion: model.inputEurPerMillion,
      outputEurPerMillion: model.outputEurPerMillion,
    });
  }
  return chatModels;
}

/**
 * Only models that the synthetic runner can reach on an unattended turn: a key
 * of the provider's own, or AI Gateway when it serves the model, the same
 * routes `resolveChatModel` takes on a real turn.
 */
export function availableEvaluationModels(
  connections: ProviderConnection[],
  gatewayAvailable: boolean,
  extraModels: PlatformEvalModel[] = [],
): EvaluationModelOption[] {
  return allEvaluationModels(connections, extraModels).filter((model) =>
    model.provider === "voyage" || model.provider === "typesafe"
      ? gatewayAvailable
      : availableModelSources(model.provider, model.modelId, connections).length > 0,
  );
}

export function evaluationModelsForStage(
  models: EvaluationModelOption[],
  stage: EvaluationStage,
  primaryProvider: Provider,
): EvaluationModelOption[] {
  if (stage === "reranker") return models.filter((model) => model.provider === "voyage");
  if (stage === "preflight")
    return models.filter(
      (model) => model.provider === "typesafe" ||
        (model.provider !== "voyage" && model.provider !== "openai_compatible"),
    );
  return models.filter(
    (model) =>
      model.provider !== "voyage" &&
      model.provider !== "typesafe" &&
      (stage !== "fallback" || model.provider !== primaryProvider),
  );
}
