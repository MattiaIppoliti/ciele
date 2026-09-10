import { z } from "zod";
import type {
  ApplicationConnection,
  ConnectorProvider,
} from "@agent-hub/core";
import {
  CONNECTOR_ACTIONS,
  CONNECTOR_PROVIDERS,
  applicationConnectionOwnerType,
  connectorAction,
} from "@agent-hub/core";
import { OperationError, defineOperation } from "./operation";

/**
 * The Applications domain over the machine surface (#839): the Organization's
 * Application Connections as the Connector action sees them, and the re-consent
 * a Connection needs before it can run an action whose scopes it lacks.
 *
 * Authorization itself is a browser round-trip (the provider's consent page),
 * so `requestReconsent` does not perform it: it validates the request, computes
 * the scope union and hands back the path of the web app's OAuth start route
 * for the caller to open. The callback route then updates the row in place.
 */

/** The shape a connection crosses the API in: never the sealed credential. */
export type ApplicationConnectionView = Pick<
  ApplicationConnection,
  | "id" | "provider" | "name" | "status" | "ownerType" | "ownerMemberId"
  | "scopes" | "providerAccountId" | "error" | "lastConnectedAt" | "createdAt" | "updatedAt"
>;

export function applicationConnectionView(
  connection: ApplicationConnection
): ApplicationConnectionView {
  return {
    id: connection.id,
    provider: connection.provider,
    name: connection.name,
    status: connection.status,
    ownerType: connection.ownerType,
    ownerMemberId: connection.ownerMemberId,
    scopes: connection.scopes,
    providerAccountId: connection.providerAccountId,
    error: connection.error,
    lastConnectedAt: connection.lastConnectedAt,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

export const listApplicationConnectionsOp = defineOperation({
  name: "applications.connections.list",
  capability: "member",
  input: z.object({
    provider: z.enum(CONNECTOR_PROVIDERS as [ConnectorProvider, ...ConnectorProvider[]]).optional(),
  }),
  entities: () => [],
  run: async (ctx, { provider }) => {
    const rows = await ctx.db.listApplicationConnections(ctx.organizationId);
    return rows
      .filter((row) => !provider || row.provider === provider)
      // A personal Connection is visible to its owner and to admins, the same
      // rule the Applications tab applies (ADR-0021).
      .filter(
        (row) =>
          row.ownerType === "organization" ||
          row.ownerMemberId === ctx.userId ||
          ctx.role === "owner" ||
          ctx.role === "admin"
      )
      .map(applicationConnectionView);
  },
});

const reconsentInput = z.object({
  id: z.string().min(1),
  /** Connector action keys whose scopes the Connection must gain. */
  actions: z.array(z.string().min(1)).max(50).optional(),
  /** Extra scopes, for callers that know the provider's vocabulary. */
  scopes: z.array(z.string().min(1).max(100)).max(50).optional(),
});

/**
 * The scope union a re-consent must request: what the Connection holds, plus
 * what the named actions need, plus anything passed explicitly. Pure, so the
 * builder can show the same list the operation will request.
 */
export function reconsentScopes(
  connection: Pick<ApplicationConnection, "provider" | "scopes">,
  actions: readonly string[] = [],
  extra: readonly string[] = []
): string[] {
  const union = new Set(connection.scopes);
  for (const key of actions) {
    const action = connectorAction(key);
    if (!action) throw new OperationError("invalid_input", `Unknown connector action "${key}"`);
    if (action.provider !== connection.provider) {
      throw new OperationError(
        "invalid_input",
        `"${key}" is a ${action.provider} action, this is a ${connection.provider} connection`
      );
    }
    for (const scope of action.requiredScopes) union.add(scope);
  }
  for (const scope of extra) union.add(scope);
  return [...union];
}

/** Path of the web app's OAuth start route that re-runs consent for one row. */
export function reconsentStartPath(
  connection: Pick<ApplicationConnection, "id" | "provider">,
  scopes: readonly string[]
): string {
  const params = new URLSearchParams({ connectionId: connection.id });
  if (scopes.length > 0) params.set("scopes", scopes.join(" "));
  return `/api/applications/oauth/${connection.provider}/start?${params.toString()}`;
}

export const requestApplicationReconsentOp = defineOperation({
  name: "applications.connections.reconsent",
  // Org-owned providers are authorized by publishers; a personal Connection is
  // re-consented only by its owner, which the start route enforces again.
  capability: "publish",
  input: reconsentInput,
  entities: () => [],
  run: async (ctx, { id, actions, scopes }) => {
    const connection = await ctx.db.getSafeApplicationConnection(id);
    if (!connection || connection.organizationId !== ctx.organizationId) {
      throw new OperationError("not_found", "Application Connection not found");
    }
    if (
      applicationConnectionOwnerType(connection.provider) === "member" &&
      connection.ownerMemberId !== ctx.userId
    ) {
      throw new OperationError(
        "invalid_input",
        "A personal connection can only be re-consented by its owner"
      );
    }
    const union = reconsentScopes(connection, actions ?? [], scopes ?? []);
    return {
      connectionId: connection.id,
      provider: connection.provider,
      currentScopes: connection.scopes,
      scopes: union,
      /** Open this path on the deployment's origin in a browser to complete consent. */
      startPath: reconsentStartPath(connection, union),
    };
  },
});

/** The catalogue as the API and the MCP tool describe it: keys, effects, fields. */
export const listConnectorActionsOp = defineOperation({
  name: "applications.connectors.list",
  capability: "member",
  input: z.object({
    provider: z.enum(CONNECTOR_PROVIDERS as [ConnectorProvider, ...ConnectorProvider[]]).optional(),
  }),
  entities: () => [],
  run: async (_ctx, { provider }) =>
    CONNECTOR_ACTIONS.filter((action) => !provider || action.provider === provider).map(
      (action) => ({
        key: action.key,
        provider: action.provider,
        title: action.title,
        description: action.description,
        effect: action.effect,
        requiredScopes: action.requiredScopes,
        fields: action.fields.map(({ name, label, type, required, template }) => ({
          name,
          label,
          type,
          required: required ?? false,
          template: template ?? false,
        })),
        outputs: action.outputs,
      })
    ),
});
