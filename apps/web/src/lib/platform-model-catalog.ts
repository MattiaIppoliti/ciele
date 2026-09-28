import { MODEL_CATALOG } from "@agent-hub/agent/client";
import type { PlatformEvalModel, Provider } from "@agent-hub/core";

export type ChatCatalog = Record<Provider, { id: string; label: string }[]>;

export function modelCatalogWith(additions: readonly PlatformEvalModel[]): ChatCatalog {
  const catalog = Object.fromEntries(
    (Object.keys(MODEL_CATALOG) as Provider[]).map((provider) => [provider, [...MODEL_CATALOG[provider]]]),
  ) as ChatCatalog;
  for (const model of additions) {
    if (!catalog[model.provider].some((entry) => entry.id === model.modelId))
      catalog[model.provider].push({ id: model.modelId, label: model.label });
  }
  return catalog;
}
