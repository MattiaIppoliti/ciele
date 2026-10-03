import {
  modelChoices,
  modelSelector,
  type ModelRef,
  type ProviderConnection,
  type PlatformEvalModel,
} from "@agent-hub/core";
import {
  MODEL_CATALOG,
  MODEL_SOURCE_NAMES,
  PROVIDER_NAMES,
  currentModelId,
  gatewayModelId,
  type ChatModelOption,
} from "./catalog";
import { availableModelSources, providerAvailability } from "./models";

/**
 * Complete configured and allowed model candidates, with capability, catalogue
 * labels, source pins and ordering resolved once. A sole eligible candidate is
 * still a candidate: Auto routing and unavailable diagnostics need it even when
 * a composer has no choice to offer.
 */
export function chatModelCandidates(
  configured: ModelRef,
  allowed: readonly ModelRef[] | undefined,
  connections: ProviderConnection[],
  platformModels: readonly PlatformEvalModel[] = [],
  optionsPolicy: { includeUnavailable?: boolean } = {},
): ChatModelOption[] {
  const choices = modelChoices(configured, allowed ?? []);

  const availability = providerAvailability(connections);
  const options: ChatModelOption[] = [];
  for (const ref of choices) {
    let unavailable = false;
    if (ref.source) {
      // A pinned choice is offered only while its own source can serve it:
      // anything else would answer on a route the asker did not pick.
      if (!availableModelSources(ref.provider, ref.modelId, connections).includes(ref.source))
        unavailable = true;
    } else {
      const available = availability[ref.provider];
      if (!available) {
        unavailable = true;
      } else {
        const gateway =
          available.gateway &&
          gatewayModelId(ref.provider, currentModelId(ref.provider, ref.modelId)) !== null;
        unavailable = !available.platform && !available.byok && !available.federated && !gateway;
      }
    }
    if (unavailable && !optionsPolicy.includeUnavailable) continue;
    // A provider with no static catalogue serves whatever its connection names
    // (#436), so there is no label to show and nothing to choose between.
    const entry = MODEL_CATALOG[ref.provider]?.find((m) => m.id === ref.modelId) ??
      platformModels.find((model) => model.provider === ref.provider && model.modelId === ref.modelId);
    if (!entry) continue;
    options.push({
      selector: modelSelector(ref),
      provider: ref.provider,
      modelId: ref.modelId,
      label: entry.label,
      ...(unavailable ? { unavailable: true } : {}),
      providerName: PROVIDER_NAMES[ref.provider],
      ...(ref.source
        ? { source: ref.source, sourceName: MODEL_SOURCE_NAMES[ref.source] }
        : {}),
    });
  }
  return options;
}

/**
 * Composer presentation of the complete candidates: fewer than two rows means
 * no choice, so existing Widget and Preview pickers remain hidden in that case.
 */
export function chatModelOptions(
  ...args: Parameters<typeof chatModelCandidates>
): ChatModelOption[] {
  const candidates = chatModelCandidates(...args);
  return candidates.length < 2 ? [] : candidates;
}

export type { ChatModelOption };
