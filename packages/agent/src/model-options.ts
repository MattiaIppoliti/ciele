import {
  modelChoices,
  modelSelector,
  type ModelRef,
  type ProviderConnection,
} from "@agent-hub/core";
import { MODEL_CATALOG, PROVIDER_NAMES, type ChatModelOption } from "./catalog";
import { providerAvailability } from "./models";

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
 * Returns **one entry, or none at all**, when there is no real choice: a
 * single-entry picker is a control that does nothing, and the composer draws no
 * picker for a list of one. That is the default state of every Assistant, and
 * the reason this returns a list rather than a flag.
 */
export function chatModelOptions(
  configured: ModelRef,
  allowed: readonly ModelRef[] | undefined,
  connections: ProviderConnection[]
): ChatModelOption[] {
  const choices = modelChoices(configured, allowed ?? []);
  if (choices.length < 2) return [];

  const availability = providerAvailability(connections);
  const options: ChatModelOption[] = [];
  for (const ref of choices) {
    const available = availability[ref.provider];
    if (!available) continue;
    if (!available.platform && !available.byok && !available.federated) continue;
    // A provider with no static catalogue serves whatever its connection names
    // (#436), so there is no label to show and nothing to choose between.
    const entry = MODEL_CATALOG[ref.provider]?.find((m) => m.id === ref.modelId);
    if (!entry) continue;
    options.push({
      selector: modelSelector(ref),
      provider: ref.provider,
      modelId: ref.modelId,
      label: entry.label,
      providerName: PROVIDER_NAMES[ref.provider],
    });
  }
  // Losing every alternative to a removed connection leaves the configured
  // model alone, which is again no choice.
  return options.length < 2 ? [] : options;
}

export type { ChatModelOption };
