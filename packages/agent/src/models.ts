import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type {
  GoogleVertexFederatedConfig,
  Provider,
  ProviderConnection,
} from "@agent-hub/core";
import { openSecret } from "@agent-hub/core";

import {
  createLocalCliRunner,
  createLocalSubscriptionModel,
  type LocalCliRunner,
} from "./local-subscription-model";
import type { LocalSubscriptionProvider } from "./local-subscriptions";
import { createGoogleVertexProvider } from "./google-vertex";

export { MODEL_CATALOG } from "./catalog";

/**
 * Providers with a fixed model catalog. The openai_compatible provider has no
 * catalog — its model ids live on the connection/env config — so the static
 * per-provider tables below deliberately exclude it; resolution reads its
 * config instead (see `compatibleModelId`).
 */
type CatalogProvider = Exclude<Provider, "openai_compatible">;

/** Cheap models used for intent classification, per provider. */
const CLASSIFIER_MODEL: Record<CatalogProvider, string> = {
  anthropic: "claude-haiku-4-5",
  openai: "gpt-5.1-mini",
  google: "gemini-3.1-flash-lite",
};

const PLATFORM_ENV: Record<CatalogProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

/** Which traffic surface a provider credential is being resolved for. */
export type KeySurface = "published" | "preview";

/**
 * Context for provider resolution. Hosted subscription rows remain retired.
 * A local Preview may explicitly advertise authenticated provider CLIs on the
 * same Mac; those capabilities never cross into published traffic.
 */
export interface KeyResolution {
  surface?: KeySurface;
  memberId?: string | null;
  localSubscriptionProviders?: LocalSubscriptionProvider[];
  localSubscriptionRunner?: LocalCliRunner;
  localSubscriptionModel?: {
    provider: LocalSubscriptionProvider;
    modelId: string;
  };
}

/**
 * Resolved OpenAI-compatible endpoint (#436): any server speaking the OpenAI
 * API. From an api_key connection's config, or the OPENAI_COMPATIBLE_* env
 * fallback (platform kind) so a self-host runs with zero in-app config.
 */
export interface OpenAiCompatibleEndpoint {
  baseUrl: string;
  chatModel: string;
  embeddingModel: string | null;
  /** The model's native dimension, kept for a future re-embed migration. */
  embeddingDims: number | null;
}

export type ProviderCredential =
  | {
      provider: CatalogProvider;
      kind: "platform" | "api_key";
      apiKey: string;
    }
  | {
      provider: "openai_compatible";
      kind: "platform" | "api_key";
      /** Optional — many local/self-hosted servers ignore authentication. */
      apiKey: string | null;
      config: OpenAiCompatibleEndpoint;
    }
  | {
      provider: "google";
      kind: "google_vertex_federated";
      config: GoogleVertexFederatedConfig;
    }
  | {
      provider: LocalSubscriptionProvider;
      kind: "local_subscription";
      run: LocalCliRunner;
      modelId?: string;
    };

/**
 * The model id a resolved credential runs when the caller has no explicit
 * choice: openai_compatible reads its configured chat model, catalog
 * providers read the given table (classifier or fallback tier).
 */
function configuredModelId(
  credential: ProviderCredential,
  table: Record<CatalogProvider, string>
): string {
  if (credential.provider === "openai_compatible" && "config" in credential) {
    return credential.config.chatModel;
  }
  return table[credential.provider as CatalogProvider];
}

/**
 * Model used when a provider serves as a fallback for another provider's
 * assistant. Deliberately the cheap/widely-available tier, not the flagship:
 * fallback keys are often free-tier, and the org never chose this provider's
 * pricing deliberately.
 */
const FALLBACK_MODEL: Record<CatalogProvider, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-5.1-mini",
  google: "gemini-3.1-flash-lite",
};

/** Reads the OPENAI_COMPATIBLE_* env fallback, or null when incomplete. */
function compatibleEnvEndpoint(): OpenAiCompatibleEndpoint | null {
  const baseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL;
  const chatModel = process.env.OPENAI_COMPATIBLE_CHAT_MODEL;
  if (!baseUrl || !chatModel) return null;
  const dims = Number(process.env.OPENAI_COMPATIBLE_EMBEDDING_DIMS);
  return {
    baseUrl,
    chatModel,
    embeddingModel: process.env.OPENAI_COMPATIBLE_EMBEDDING_MODEL || null,
    embeddingDims: Number.isFinite(dims) && dims > 0 ? dims : null,
  };
}

/**
 * Resolves the openai_compatible provider: an org's api_key connection wins
 * (its key is optional — many local servers ignore auth), then the
 * OPENAI_COMPATIBLE_* platform env, so a self-host runs fully local with
 * zero in-app config.
 */
function resolveOpenAiCompatibleCredential(
  connections: ProviderConnection[]
): ProviderCredential | null {
  const connection = connections.find(
    (c) =>
      c.provider === "openai_compatible" &&
      c.type === "api_key" &&
      c.config.kind === "openai_compatible"
  );
  if (connection && connection.config.kind === "openai_compatible") {
    let apiKey: string | null = null;
    if (connection.encryptedKey) {
      try {
        apiKey = openSecret(connection.encryptedKey) || null;
      } catch {
        // An undecryptable key degrades to keyless — local servers allow it.
      }
    }
    return {
      provider: "openai_compatible",
      kind: "api_key",
      apiKey,
      config: {
        baseUrl: connection.config.baseUrl,
        chatModel: connection.config.chatModel,
        embeddingModel: connection.config.embeddingModel ?? null,
        embeddingDims: connection.config.embeddingDims ?? null,
      },
    };
  }
  const env = compatibleEnvEndpoint();
  if (env) {
    return {
      provider: "openai_compatible",
      kind: "platform",
      apiKey: process.env.OPENAI_COMPATIBLE_API_KEY || null,
      config: env,
    };
  }
  return null;
}

/**
 * Resolves an authenticated provider capability. A Member's explicitly
 * detected local CLI wins only in local Preview; otherwise order is the
 * Organization BYOK connection, provider-specific federated credential, then
 * platform key. Legacy database subscription rows remain ignored everywhere.
 */
export function resolveProviderCredential(
  provider: Provider,
  connections: ProviderConnection[],
  resolution: KeyResolution = {}
): ProviderCredential | null {
  if (provider === "openai_compatible") {
    return resolveOpenAiCompatibleCredential(connections);
  }
  if (
    resolution.surface === "preview" &&
    resolution.memberId &&
    (provider === "openai" || provider === "anthropic") &&
    resolution.localSubscriptionProviders?.includes(provider)
  ) {
    return {
      provider,
      kind: "local_subscription",
      run: resolution.localSubscriptionRunner ?? createLocalCliRunner(),
      modelId:
        resolution.localSubscriptionModel?.provider === provider
          ? resolution.localSubscriptionModel.modelId
          : undefined,
    };
  }
  const byok = connections.find(
    (c) => c.provider === provider && c.type === "api_key" && c.encryptedKey
  );
  if (byok?.encryptedKey) {
    try {
      const apiKey = openSecret(byok.encryptedKey);
      if (apiKey) {
        return {
          provider,
          kind: "api_key",
          apiKey,
        };
      }
    } catch {
      // Fall through to the next available credential if decryption fails.
    }
  }
  if (provider === "google") {
    const federated = connections.find(
      (c) =>
        c.provider === "google" &&
        c.type === "federated" &&
        c.config.kind === "google_vertex"
    );
    if (federated?.config.kind === "google_vertex") {
      return {
        provider: "google",
        kind: "google_vertex_federated",
        config: federated.config,
      };
    }
  }
  const platformKey = process.env[PLATFORM_ENV[provider]];
  return platformKey
    ? { provider, kind: "platform", apiKey: platformKey }
    : null;
}

/**
 * Compatibility wrapper for callers that still only need a static API key
 * string. New runtime paths should prefer `resolveProviderCredential`.
 */
export function resolveProviderKey(
  provider: Provider,
  connections: ProviderConnection[],
  resolution: KeyResolution = {}
): string | null {
  const credential = resolveProviderCredential(provider, connections, resolution);
  return credential && "apiKey" in credential ? credential.apiKey : null;
}

export function providerAvailability(
  connections: ProviderConnection[]
): Record<Provider, { platform: boolean; byok: boolean; federated: boolean }> {
  const availability = {} as Record<
    Provider,
    { platform: boolean; byok: boolean; federated: boolean }
  >;
  for (const provider of ["anthropic", "openai", "google"] as CatalogProvider[]) {
    availability[provider] = {
      platform: Boolean(process.env[PLATFORM_ENV[provider]]),
      byok: connections.some(
        (c) => c.provider === provider && c.type === "api_key" && c.encryptedKey
      ),
      federated: connections.some(
        (c) => c.provider === provider && c.type === "federated"
      ),
    };
  }
  availability.openai_compatible = {
    platform: compatibleEnvEndpoint() !== null,
    // The key is optional for compatible endpoints, so a connection counts
    // as BYOK by existing at all, not by carrying an encrypted key.
    byok: connections.some(
      (c) =>
        c.provider === "openai_compatible" &&
        c.type === "api_key" &&
        c.config.kind === "openai_compatible"
    ),
    federated: false,
  };
  return availability;
}

function buildModel(
  provider: Provider,
  modelId: string,
  credential: ProviderCredential
): LanguageModel {
  if (credential.kind === "local_subscription") {
    return createLocalSubscriptionModel({
      provider: credential.provider,
      modelId,
      cliModelId: credential.modelId ?? null,
      run: credential.run,
    });
  }
  if (credential.provider === "openai_compatible" && "config" in credential) {
    return createOpenAICompatible({
      name: "openai-compatible",
      baseURL: credential.config.baseUrl,
      apiKey: credential.apiKey ?? undefined,
    }).chatModel(modelId);
  }
  switch (provider) {
    case "anthropic":
      if (!("apiKey" in credential)) break;
      return createAnthropic({ apiKey: credential.apiKey })(modelId);
    case "openai":
      if (!("apiKey" in credential)) break;
      return createOpenAI({ apiKey: credential.apiKey })(modelId);
    case "google":
      if (credential.kind === "google_vertex_federated") {
        return createGoogleVertexProvider(credential.config)(modelId);
      }
      if (!("apiKey" in credential)) break;
      return createGoogleGenerativeAI({ apiKey: credential.apiKey })(modelId);
  }
  throw new Error(`Unsupported ${provider} credential: ${credential.kind}`);
}

/** Chat model for an assistant, or null when no credential is configured. */
export function getChatModel(
  provider: Provider,
  modelId: string,
  connections: ProviderConnection[],
  resolution: KeyResolution = {}
): LanguageModel | null {
  const credential = resolveProviderCredential(
    provider,
    connections,
    resolution
  );
  return credential ? buildModel(provider, modelId, credential) : null;
}

/**
 * Order the connected local CLIs answer in when the Member picked no model.
 * Claude Code first, on measured cold-start cost alone: every model call spawns
 * the CLI afresh (~8s for `claude --print` vs ~14–16s for `codex exec`, whose
 * built-in prompt is ~24k tokens before ours), and a multi-step turn multiplies
 * that difference. An explicit selection always outranks this order.
 */
const LOCAL_PROVIDER_ORDER: LocalSubscriptionProvider[] = [
  "anthropic",
  "openai",
];

export function orderedLocalProviders(
  resolution: KeyResolution
): LocalSubscriptionProvider[] {
  const connected = resolution.localSubscriptionProviders ?? [];
  const selected = resolution.localSubscriptionModel;
  const byPreference = [
    ...LOCAL_PROVIDER_ORDER.filter((provider) => connected.includes(provider)),
    ...connected.filter((provider) => !LOCAL_PROVIDER_ORDER.includes(provider)),
  ];
  return selected && connected.includes(selected.provider)
    ? [
        selected.provider,
        ...byPreference.filter((provider) => provider !== selected.provider),
      ]
    : byPreference;
}

export interface ResolvedChatModel {
  model: LanguageModel;
  provider: Provider;
  modelId: string;
  credentialKind: ProviderCredential["kind"];
  /** True when the assistant's configured provider had no credential and another provider answered instead. */
  usedFallback: boolean;
}

/**
 * Chat model with cross-provider fallback: prefer the assistant's configured
 * provider/model, but when that provider has no key (BYOK or platform env),
 * answer with any provider that does. A misconfigured provider must degrade to
 * a different LLM, never to the keyword engine, or system prompts silently stop
 * applying.
 */
export function resolveChatModel(
  preferredProvider: Provider,
  preferredModelId: string,
  connections: ProviderConnection[],
  resolution: KeyResolution = {}
): ResolvedChatModel | null {
  // A member's connected local subscription outranks the assistant's
  // configured provider in Preview — even when the organization holds an API
  // key or federated credential for it. The Chat-settings default model
  // (resolution.localSubscriptionModel) applied upstream lands on the first
  // branch below; this covers the "Automatic" preference.
  //
  // An EXPLICIT local-model selection must pick its own provider, not merely
  // the first connected one: with both CLIs connected, choosing a Claude model
  // while OpenAI happened to be `localSubscriptionProviders[0]` used to resolve
  // to OpenAI's fallback tier (gpt-5.1-mini) and ignore the selection entirely.
  // Absent a selection, `orderedLocalProviders` picks the cheapest CLI to spawn.
  const localProvider = orderedLocalProviders(resolution)[0];
  if (localProvider && localProvider !== preferredProvider) {
    const localCredential = resolveProviderCredential(
      localProvider,
      connections,
      resolution
    );
    if (localCredential?.kind === "local_subscription") {
      const modelId =
        resolution.localSubscriptionModel?.provider === localProvider
          ? resolution.localSubscriptionModel.modelId
          : FALLBACK_MODEL[localProvider];
      return {
        model: buildModel(localProvider, modelId, localCredential),
        provider: localProvider,
        modelId,
        credentialKind: localCredential.kind,
        usedFallback: false,
      };
    }
  }
  const preferredCredential = resolveProviderCredential(
    preferredProvider,
    connections,
    resolution
  );
  if (preferredCredential) {
    // An assistant configured on openai_compatible may leave the model blank
    // (or hold another provider's default): the connection's chat model is
    // the source of truth for what the endpoint serves.
    const modelId =
      preferredProvider === "openai_compatible"
        ? configuredModelId(preferredCredential, FALLBACK_MODEL)
        : preferredModelId;
    return {
      model: buildModel(preferredProvider, modelId, preferredCredential),
      provider: preferredProvider,
      modelId,
      credentialKind: preferredCredential.kind,
      usedFallback: false,
    };
  }
  const fallbackOrder = [
    ...orderedLocalProviders(resolution),
    ...(["google", "anthropic", "openai", "openai_compatible"] as Provider[]),
  ].filter(
    (provider, index, providers) =>
      provider !== preferredProvider && providers.indexOf(provider) === index
  );
  for (const provider of fallbackOrder) {
    if (provider === preferredProvider) continue;
    const credential = resolveProviderCredential(
      provider,
      connections,
      resolution
    );
    if (!credential) continue;
    const modelId = configuredModelId(credential, FALLBACK_MODEL);
    return {
      model: buildModel(provider, modelId, credential),
      provider,
      modelId,
      credentialKind: credential.kind,
      usedFallback: true,
    };
  }
  return null;
}

export interface ResolvedClassifierModel {
  model: LanguageModel;
  provider: Provider;
  modelId: string;
  credentialKind: ProviderCredential["kind"];
}

/**
 * Cheap classifier model for intent routing, with the resolved provider/model
 * metadata the usage ledger records. Prefers the assistant's own provider,
 * then any provider with an available key.
 */
export function getClassifierModel(
  preferredProvider: Provider,
  connections: ProviderConnection[],
  resolution: KeyResolution = {}
): ResolvedClassifierModel | null {
  const order: Provider[] = [
    preferredProvider,
    ...orderedLocalProviders(resolution),
    ...(["google", "anthropic", "openai", "openai_compatible"] as Provider[]).filter(
      (p) => p !== preferredProvider
    ),
  ].filter((provider, index, providers) => providers.indexOf(provider) === index);
  for (const provider of order) {
    const credential = resolveProviderCredential(
      provider,
      connections,
      resolution
    );
    if (credential) {
      const modelId = configuredModelId(credential, CLASSIFIER_MODEL);
      return {
        model: buildModel(provider, modelId, credential),
        provider,
        modelId,
        credentialKind: credential.kind,
      };
    }
  }
  return null;
}
