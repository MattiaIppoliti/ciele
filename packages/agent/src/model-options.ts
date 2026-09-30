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
 * The models a chat window may actually offer, from what an admin allowed.
 *
 * Two filters, and the order matters. The allow-list decides *intent*; the
 * Organization's Provider Connections decide *capability*. A model an admin
 * picked months ago whose provider has since lost its credential is dropped
 * here rather than offered and failed on: the fallback inside `resolveChatModel`
 * would quietly answer on a different provider than the one the asker chose,
 * which is worse than never offering it.
 *
 * Preview can retain missing capabilities as disabled `unavailable` rows.
 * Published chats keep the capability filter.
 *
 * Returns **one entry, or none at all**, when there is no real choice: a
 * single-entry picker is a control that does nothing, and the composer draws no
 * picker for a list of one. That is the default state of every Assistant, and
 * the reason this returns a list rather than a flag.
 */
export function chatModelOptions(
  configured: ModelRef,
  allowed: readonly ModelRef[] | undefined,
  connections: ProviderConnection[],
  platformModels: readonly PlatformEvalModel[] = [],
  optionsPolicy: { includeUnavailable?: boolean } = {},
): ChatModelOption[] {
  const choices = modelChoices(configured, allowed ?? []);
  if (choices.length < 2) return [];

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
  // Losing every alternative to a removed connection leaves the configured
  // model alone, which is again no choice.
  return options.length < 2 ? [] : options;
}

export type { ChatModelOption };
