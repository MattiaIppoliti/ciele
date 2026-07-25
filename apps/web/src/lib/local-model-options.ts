import type { Provider } from "@agent-hub/db";
import {
  parseLocalModelSelector,
  type ConnectorProvider,
  type ConnectorProviderStatus,
} from "./local-connector-protocol";

export interface LocalPreviewModelPreference {
  provider: ConnectorProvider;
  modelId: string;
}

/** A browser preference may override Preview only through a verified local capability. */
export function resolveLocalPreviewModelPreference(
  selector: unknown,
  verifiedProviders: ConnectorProvider[]
): LocalPreviewModelPreference | null {
  const parsed = parseLocalModelSelector(selector);
  if (!parsed) return null;
  if (!verifiedProviders.includes(parsed.provider)) return null;
  return parsed;
}

export function applyLocalPreviewModelPreference<
  T extends { modelProvider: Provider; modelId: string },
>(
  assistant: T,
  selector: unknown,
  verifiedProviders: ConnectorProvider[]
): T {
  const preference = resolveLocalPreviewModelPreference(
    selector,
    verifiedProviders
  );
  if (!preference) return assistant;
  return {
    ...assistant,
    modelProvider: preference.provider,
    modelId: preference.modelId,
  };
}

export interface ModelOption {
  value: string;
  label: string;
  provider: ConnectorProvider;
  source: "local";
  inputModalities: Array<"text" | "image">;
}

export interface ModelOptionGroup {
  source: "local";
  label: string;
  options: ModelOption[];
}

export function buildModelOptionGroups(input: {
  localProviders: ConnectorProviderStatus[];
}): ModelOptionGroup[] {
  const local = input.localProviders.flatMap((provider) =>
    provider.connected
      ? (provider.models ?? []).map((model) => ({
          value: `local:${provider.provider}:${model.id}`,
          label: `${provider.provider === "openai" ? "ChatGPT" : "Claude"} · ${model.label}`,
          provider: provider.provider,
          source: "local" as const,
          inputModalities: model.inputModalities,
        }))
      : []
  );

  const seen = new Set<string>();
  const options = local.filter((option) => {
    if (seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
  return options.length > 0
    ? [{ source: "local", label: "Local subscriptions", options }]
    : [];
}
