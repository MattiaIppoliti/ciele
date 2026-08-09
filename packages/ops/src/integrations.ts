import type {
  AnthropicWifFederatedConfig,
  ApiEndpointSpec,
  ApiIntegrationAuthType,
  AzureOpenAiFederatedConfig,
  GoogleVertexFederatedConfig,
  OpenAiCompatibleConfig,
  ProviderConnection,
  SsoProviderKind,
} from "@agent-hub/core";
import { sealSecret } from "@agent-hub/core";
import { z } from "zod";
import { OperationError, defineOperation, type OperationContext } from "./operation";

const idSchema = z.string().min(1);
const identityClaimSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_.:-]{1,64}$/, "That identity claim name isn't valid")
  .optional();

async function requireAssistant(ctx: OperationContext, id: string) {
  const assistant = await ctx.db.getAssistant(id);
  if (!assistant || assistant.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Assistant not found");
  }
  return assistant;
}

export interface ApiIntegrationView {
  name: string;
  baseUrl: string;
  authType: ApiIntegrationAuthType;
  authHeaderName: string;
  authUsername: string;
  hasCredential: boolean;
  endpoints: ApiEndpointSpec[];
}

const endpointSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  path: z.string().trim().min(1).max(2_000),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  purpose: z.string().trim().min(1).max(5_000),
  params: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    type: z.enum(["string", "number", "boolean"]).optional(),
    in: z.enum(["path", "query", "header"]).optional(),
    required: z.boolean().optional(),
    value: z.string().optional(),
  })).optional(),
  responseKeys: z.array(z.string()).optional(),
}) satisfies z.ZodType<ApiEndpointSpec>;

export const apiIntegrationInputSchema = z.object({
  name: z.string().trim().max(200),
  baseUrl: z.string().trim().min(1),
  authType: z.enum(["none", "bearer", "api_key", "basic"]),
  authHeaderName: z.string().trim().max(200).optional(),
  authUsername: z.string().trim().max(500).optional(),
  credential: z.string().optional(),
  endpoints: z.array(endpointSchema).min(1).max(200),
});

export const getApiIntegrationOp = defineOperation({
  name: "apiIntegrations.get",
  capability: "member",
  input: z.object({ assistantId: idSchema }),
  entities: () => [],
  run: async (ctx, { assistantId }): Promise<ApiIntegrationView | null> => {
    await requireAssistant(ctx, assistantId);
    const integration = await ctx.db.getApiIntegration(assistantId);
    return integration
      ? {
          name: integration.name,
          baseUrl: integration.baseUrl,
          authType: integration.authType,
          authHeaderName: integration.authHeaderName,
          authUsername: integration.authUsername,
          hasCredential: integration.encryptedCredential !== null,
          endpoints: integration.endpoints,
        }
      : null;
  },
});

export const setApiIntegrationOp = defineOperation({
  name: "apiIntegrations.set",
  capability: "edit",
  input: z.object({ assistantId: idSchema, input: apiIntegrationInputSchema }),
  entities: ({ assistantId }) => [{ kind: "assistantEditor" as const, assistantId }],
  run: async (ctx, { assistantId, input }): Promise<ApiIntegrationView> => {
    await requireAssistant(ctx, assistantId);
    let base: URL;
    try {
      base = new URL(input.baseUrl);
    } catch {
      throw new OperationError(
        "invalid_input",
        "Enter a valid base URL, e.g. https://api.example.com"
      );
    }
    if (base.protocol !== "https:") {
      throw new OperationError("invalid_input", "The base URL must use https");
    }
    const endpoints = input.endpoints.filter((endpoint) => endpoint.path.trim());
    if (!endpoints.length) {
      throw new OperationError("invalid_input", "Describe at least one endpoint");
    }
    const stored = await ctx.db.setApiIntegration({
      assistantId,
      organizationId: ctx.organizationId,
      name: input.name || base.hostname,
      baseUrl: base.toString().replace(/\/$/, ""),
      authType: input.authType,
      authHeaderName: input.authHeaderName ?? "",
      authUsername: input.authUsername ?? "",
      ...(input.credential === undefined
        ? {}
        : { encryptedCredential: input.credential ? sealSecret(input.credential) : null }),
      endpoints,
    });
    return {
      name: stored.name,
      baseUrl: stored.baseUrl,
      authType: stored.authType,
      authHeaderName: stored.authHeaderName,
      authUsername: stored.authUsername,
      hasCredential: stored.encryptedCredential !== null,
      endpoints: stored.endpoints,
    };
  },
});

export const deleteApiIntegrationOp = defineOperation({
  name: "apiIntegrations.delete",
  capability: "edit",
  input: z.object({ assistantId: idSchema }),
  entities: ({ assistantId }) => [{ kind: "assistantEditor" as const, assistantId }],
  run: async (ctx, { assistantId }) => {
    await requireAssistant(ctx, assistantId);
    await ctx.db.deleteApiIntegration(assistantId);
  },
});

export const getSsoConnectionOp = defineOperation({
  name: "sso.connection.get",
  capability: "manageMembers",
  input: z.object({}),
  entities: () => [],
  run: async (ctx) => {
    const connection = await ctx.db.getSsoConnection(ctx.organizationId);
    return connection
      ? {
          connected: true as const,
          provider: connection.provider,
          config: connection.config,
          hasClientSecret: connection.encryptedSecret !== null,
          validationStatus: connection.validationStatus,
          validatedAt: connection.validatedAt,
        }
      : { connected: false as const };
  },
});

export const ssoConnectionInputSchema = z.object({
  provider: z.enum(["entra", "clerk", "workos"]),
  clientId: z.string().trim().min(1),
  tenantId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
  identityClaim: identityClaimSchema,
});

export const setSsoConnectionOp = defineOperation({
  name: "sso.connection.set",
  capability: "manageMembers",
  input: ssoConnectionInputSchema,
  entities: () => [{ kind: "assistantList" as const }],
  run: async (ctx, input) => {
    if (input.provider !== "entra") {
      throw new OperationError("invalid_input", "This provider isn't available yet");
    }
    await ctx.db.setSsoConnection(ctx.organizationId, {
      provider: input.provider as SsoProviderKind,
      config: {
        clientId: input.clientId,
        tenantId: input.tenantId,
        ...(input.identityClaim ? { identityClaim: input.identityClaim } : {}),
      },
      encryptedSecret: sealSecret(input.clientSecret),
    });
    return getSsoConnectionOp.run(ctx, {});
  },
});

export const disconnectSsoConnectionOp = defineOperation({
  name: "sso.connection.disconnect",
  capability: "manageMembers",
  input: z.object({}),
  entities: () => [{ kind: "assistantList" as const }],
  run: (ctx) => ctx.db.clearSsoConnection(ctx.organizationId),
});

export interface ProviderConnectionView
  extends Omit<ProviderConnection, "encryptedKey"> {
  hasCredential: boolean;
}

function providerView(connection: ProviderConnection): ProviderConnectionView {
  const { encryptedKey, ...safe } = connection;
  return { ...safe, hasCredential: encryptedKey !== null };
}

export const listProviderConnectionsOp = defineOperation({
  name: "providers.list",
  capability: "manageMembers",
  input: z.object({}),
  entities: () => [],
  run: async (ctx) =>
    (await ctx.db.listProviderConnections(ctx.organizationId)).map(providerView),
});

function keyHintOf(secret: string): string {
  return secret.length >= 4 ? `…${secret.slice(-4)}` : "";
}

export const createProviderApiKeyOp = defineOperation({
  name: "providers.createApiKey",
  capability: "manageMembers",
  input: z.object({
    provider: z.enum(["anthropic", "openai", "google"]),
    apiKey: z.string().trim().min(1),
    displayName: z.string().trim().max(200).optional(),
  }),
  entities: () => [{ kind: "aiSettings" as const }],
  run: async (ctx, input): Promise<{ connection?: ProviderConnectionView; error?: string }> => {
    const validation = await ctx.ports?.validateProviderApiKey?.(
      input.provider,
      input.apiKey
    );
    if (!validation) return { error: "Provider validation is not configured" };
    if (!validation.ok) return { error: validation.error };
    const connection = await ctx.db.createProviderConnection(ctx.organizationId, {
      type: "api_key",
      provider: input.provider,
      displayName: input.displayName ?? "",
      encryptedKey: sealSecret(input.apiKey),
      keyHint: keyHintOf(input.apiKey),
      createdBy: ctx.userId || null,
    });
    return { connection: providerView(connection) };
  },
});

export const openAiCompatibleInputSchema = z.object({
  displayName: z.string().trim().max(200).optional(),
  baseUrl: z.string().trim().min(1),
  apiKey: z.string().trim().optional(),
  chatModel: z.string().trim().min(1),
  embeddingModel: z.string().trim().optional(),
  embeddingDims: z.number().int().positive().optional(),
});

export const createOpenAiCompatibleConnectionOp = defineOperation({
  name: "providers.createOpenAiCompatible",
  capability: "manageMembers",
  input: openAiCompatibleInputSchema,
  entities: () => [{ kind: "aiSettings" as const }],
  run: async (ctx, input): Promise<{ connection?: ProviderConnectionView; error?: string }> => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(input.baseUrl);
    } catch {
      return { error: "Base URL must be a valid http(s) URL" };
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return { error: "Base URL must be a valid http(s) URL" };
    }
    const config: OpenAiCompatibleConfig = {
      kind: "openai_compatible",
      baseUrl: input.baseUrl,
      chatModel: input.chatModel,
      ...(input.embeddingModel ? { embeddingModel: input.embeddingModel } : {}),
      ...(input.embeddingDims !== undefined ? { embeddingDims: input.embeddingDims } : {}),
    };
    const connection = await ctx.db.createProviderConnection(ctx.organizationId, {
      type: "api_key",
      provider: "openai_compatible",
      displayName: input.displayName || "OpenAI-compatible",
      encryptedKey: input.apiKey ? sealSecret(input.apiKey) : null,
      keyHint: input.apiKey ? keyHintOf(input.apiKey) : "",
      createdBy: ctx.userId || null,
      config,
    });
    return { connection: providerView(connection) };
  },
});

export const federatedProviderInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("google_vertex"),
    displayName: z.string().trim().max(200).optional(),
    projectId: z.string().trim().min(1),
    location: z.string().trim().min(1),
    workloadIdentityAudience: z.string().trim().min(1),
    serviceAccountEmail: z.string().trim().optional(),
  }),
  z.object({
    kind: z.literal("anthropic_wif"),
    displayName: z.string().trim().max(200).optional(),
    workloadIdentityAudience: z.string().trim().min(1),
    organizationId: z.string().trim().optional(),
    workspaceId: z.string().trim().optional(),
  }),
  z.object({
    kind: z.literal("azure_openai"),
    displayName: z.string().trim().max(200).optional(),
    tenantId: z.string().trim().min(1),
    endpoint: z.string().trim().min(1),
    deployment: z.string().trim().min(1),
    clientId: z.string().trim().optional(),
    audience: z.string().trim().optional(),
  }),
]);

export const createFederatedProviderConnectionOp = defineOperation({
  name: "providers.createFederated",
  capability: "manageMembers",
  input: federatedProviderInputSchema,
  entities: () => [{ kind: "aiSettings" as const }],
  run: async (ctx, input): Promise<ProviderConnectionView> => {
    let provider: "google" | "anthropic" | "azure_openai";
    let displayName: string;
    let config:
      | GoogleVertexFederatedConfig
      | AnthropicWifFederatedConfig
      | AzureOpenAiFederatedConfig;
    if (input.kind === "google_vertex") {
      provider = "google";
      displayName = input.displayName || `Google Vertex (${input.projectId}/${input.location})`;
      config = {
        kind: input.kind,
        projectId: input.projectId,
        location: input.location,
        workloadIdentityAudience: input.workloadIdentityAudience,
        ...(input.serviceAccountEmail ? { serviceAccountEmail: input.serviceAccountEmail } : {}),
      };
    } else if (input.kind === "anthropic_wif") {
      provider = "anthropic";
      displayName = input.displayName || "Anthropic WIF";
      config = {
        kind: input.kind,
        workloadIdentityAudience: input.workloadIdentityAudience,
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      };
    } else {
      provider = "azure_openai";
      displayName = input.displayName || `Azure OpenAI (${input.deployment})`;
      config = {
        kind: input.kind,
        tenantId: input.tenantId,
        endpoint: input.endpoint,
        deployment: input.deployment,
        ...(input.clientId ? { clientId: input.clientId } : {}),
        ...(input.audience ? { audience: input.audience } : {}),
      };
    }
    return providerView(
      await ctx.db.createProviderConnection(ctx.organizationId, {
        type: "federated",
        provider,
        displayName,
        encryptedKey: null,
        keyHint: "",
        createdBy: ctx.userId || null,
        config,
      })
    );
  },
});

export const deleteProviderConnectionOp = defineOperation({
  name: "providers.delete",
  capability: "manageMembers",
  input: z.object({ id: idSchema }),
  entities: () => [{ kind: "aiSettings" as const }],
  run: async (ctx, { id }) => {
    const connection = (await ctx.db.listProviderConnections(ctx.organizationId)).find(
      (item) => item.id === id
    );
    if (!connection) throw new OperationError("not_found", "Connection not found");
    await ctx.db.deleteProviderConnection(id);
  },
});

export const setEmbeddingConnectionOp = defineOperation({
  name: "providers.setEmbedding",
  capability: "manageMembers",
  input: z.object({ connectionId: idSchema.nullable() }),
  entities: () => [{ kind: "aiSettings" as const }],
  run: async (ctx, { connectionId }) => {
    if (connectionId) {
      const owned = (await ctx.db.listProviderConnections(ctx.organizationId)).some(
        (connection) => connection.id === connectionId
      );
      if (!owned) throw new OperationError("not_found", "Connection not found");
    }
    await ctx.db.setEmbeddingConnectionId(ctx.organizationId, connectionId);
    return { connectionId };
  },
});
