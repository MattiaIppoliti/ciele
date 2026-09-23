import type { Provider, ProviderConnection } from "@agent-hub/core";
import { providerAvailability } from "@agent-hub/agent";

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
    return !available.platform && !available.byok && !available.federated;
  });
}
