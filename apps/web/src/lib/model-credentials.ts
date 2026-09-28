import {
  modelSelector,
  type ModelSource,
  type Provider,
  type ProviderConnection,
} from "@agent-hub/core";
import { availableModelSources, providerAvailability } from "@agent-hub/agent";
import type { ChatCatalog } from "@/lib/platform-model-catalog";

/**
 * The providers this Organization cannot answer on yet: no platform key, no
 * Provider Connection, no federated access.
 *
 * The editor's model allow-list is *intent*, so it never hides a model behind
 * this. `chatModelOptions` is *capability*, and it drops a ticked model whose
 * provider has no credential rather than offering a picker entry that would
 * fail. Between the two sat the thing that made the Preview look broken: the
 * form counted three models while the composer drew no picker at all, and
 * nothing on the page said why. This is what lets the form say it.
 */
export function providersWithoutCredential(
  connections: ProviderConnection[]
): Provider[] {
  const availability = providerAvailability(connections);
  return (Object.keys(availability) as Provider[]).filter((provider) => {
    const available = availability[provider];
    return (
      !available.platform && !available.byok && !available.federated && !available.gateway
    );
  });
}

/**
 * The sources that can serve each catalogue model now, keyed by its automatic
 * selector: what the Source select and the allow-list's tagged rows offer.
 */
export function modelSourcesByModel(
  connections: ProviderConnection[],
  catalog: ChatCatalog
): Record<string, ModelSource[]> {
  const sources: Record<string, ModelSource[]> = {};
  for (const provider of Object.keys(catalog) as Provider[]) {
    for (const model of catalog[provider]) {
      sources[modelSelector({ provider, modelId: model.id })] = availableModelSources(
        provider,
        model.id,
        connections
      );
    }
  }
  return sources;
}
