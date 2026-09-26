import { sealSecret, type ApplicationConnection, type ApplicationScopeOption } from "@agent-hub/core";
import { discoverApplicationConnectionScopes, type ApplicationCredentials } from "@agent-hub/agent";
import { getWidgetDb } from "@/lib/widget-db";

/**
 * What an Application Connection can import from, as its provider lists it
 * now. Discovery may rotate an OAuth token, and the new one has to be sealed
 * and kept on the system Db or the next call fails with the old one. One copy
 * for the two callers: the Import lifecycle's port (validating a selection)
 * and the console's browse action (showing the choices).
 */
export async function discoverScopesKeepingCredentials(
  connection: ApplicationConnection
): Promise<ApplicationScopeOption[]> {
  const persist = async (credentials: ApplicationCredentials) => {
    await getWidgetDb().updateApplicationConnection(connection.id, {
      sealedCredentials: sealSecret(JSON.stringify(credentials)),
      status: "connected",
      error: "",
      lastConnectedAt: new Date().toISOString(),
    });
  };
  const discovery = await discoverApplicationConnectionScopes(connection, undefined, persist);
  if (discovery.refreshedCredentials) await persist(discovery.refreshedCredentials);
  return discovery.scopes;
}
