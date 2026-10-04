import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGateway, wrapLanguageModel, type LanguageModel } from "ai";
import { MODEL_SOURCES } from "@agent-hub/core";
import type {
  Assistant,
  GoogleVertexFederatedConfig,
  ModelSource,
  Provider,
  ProviderConnection,
} from "@agent-hub/core";
import { openSecret } from "@agent-hub/core";
import { guardedOpenAiCompatibleFetch } from "./openai-compatible-guard";

import {
  createLocalCliRunner,
  createLocalSubscriptionModel,
  type LocalCliRunner,
} from "./local-subscription-model";
import type { LocalSubscriptionProvider } from "./local-subscriptions";
import { createGoogleVertexProvider } from "./google-vertex";
import { currentModelId, gatewayModelId } from "./catalog";
import { bindModelCapacity, contextBudgetMiddleware } from "./context-budget";
import { getRuntimeHost } from "./host";
import { capacityRetryMiddleware } from "./rate-limit-retry";

export { MODEL_CATALOG } from "./catalog";

/**
 * Providers with a fixed model catalog. The openai_compatible provider has no
 * catalog, its model ids live on the connection/env config, so the static
 * per-provider tables below deliberately exclude it; resolution reads its
 * config instead (see `compatibleModelId`).
 */
export type CatalogProvider = Exclude<Provider, "openai_compatible">;

/**
 * Cheap models used for intent classification, per provider. Exported for the
 * decision resolver (#950), whose adapter fallback wraps the same tier.
 */
export const CLASSIFIER_MODEL: Record<CatalogProvider, string> = {
  // No Claude model below Sonnet 5 remains in Ciele (Haiku 4.5 is retired).
  anthropic: "claude-sonnet-5",
  openai: "gpt-5.4-mini",
  google: "gemini-3.5-flash-lite",
};

const PLATFORM_ENV: Record<CatalogProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

/**
 * Which traffic surface a provider credential is being resolved for.
 *
 * `teammate` is internal chat (#769). It is its own value rather than a second
 * meaning for `preview`, because the ADR-0007 boundary now names two surfaces
 * where a personal subscription may run, and a boundary stated in an ADR should
 * be readable in the code that enforces it.
 */
export type KeySurface = "published" | "preview" | "teammate";

/**
 * Context for provider resolution. Hosted subscription rows remain retired.
 * A local Preview may explicitly advertise authenticated provider CLIs on the
 * same Mac; those capabilities never cross into published traffic.
 */
export interface KeyResolution {
  surface?: KeySurface;
  /**
   * The source the preferred model is pinned to (an Assistant's or Teammate's
   * `modelSource`, or a pinned allow-list entry). Absent is automatic. It pins
   * the **preferred** model only: when that source cannot serve it, the
   * cross-provider fallback runs automatically, as it does for a missing key.
   */
  source?: ModelSource;
  /**
   * Whether the automatic chain may end in AI Gateway. Only a chat or
   * classifier model is built for the Gateway route; every other caller
   * (embeddings, the decision adapter) hands the key to the provider's own
   * SDK, which a Gateway key would fail against. Off unless asked for.
   */
  gateway?: boolean;
  /**
   * Synthetic fallback experiments only (Eval): the providers that may supply
   * a credential this turn. Leaving the Assistant's own provider out is what
   * makes it unavailable, so the real fallback path runs.
   */
  allowedProviders?: readonly Provider[];
  /** Synthetic fallback experiments only: compare a specific reserve model. */
  fallbackModel?: { provider: Provider; modelId: string };
  /**
   * The Member whose turn this is. The personal-subscription branch needs it:
   * a subscription may power its owner's turns and nobody else's, and "who is
   * asking" is the only thing that distinguishes the two.
   */
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
  contextWindow?: number;
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
      /** Optional, many local/self-hosted servers ignore authentication. */
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
    }
  | {
      provider: CatalogProvider;
      /** `ai_gateway` is the Organization's key; `platform` is Ciele's. */
      kind: "ai_gateway" | "platform";
      apiKey: string;
      route: "gateway";
    };

const PLATFORM_GATEWAY_ENV = "AI_GATEWAY_API_KEY";

function isGatewayCredential(
  credential: ProviderCredential
): credential is Extract<ProviderCredential, { route: "gateway" }> {
  return "route" in credential && credential.route === "gateway";
}

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
  return credential.kind === "local_subscription" && credential.modelId ? credential.modelId : table[credential.provider as CatalogProvider];
}

/**
 * Model used when a provider serves as a fallback for another provider's
 * assistant. Deliberately the cheap/widely-available tier, not the flagship:
 * fallback keys are often free-tier, and the org never chose this provider's
 * pricing deliberately.
 */
const FALLBACK_MODEL: Record<CatalogProvider, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-5.4-mini",
  google: "gemini-3.5-flash-lite",
};

/** Reads the OPENAI_COMPATIBLE_* env fallback, or null when incomplete. */
function compatibleEnvEndpoint(): OpenAiCompatibleEndpoint | null {
  const baseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL;
  const chatModel = process.env.OPENAI_COMPATIBLE_CHAT_MODEL;
  if (!baseUrl || !chatModel) return null;
  return {
    baseUrl,
    chatModel,
    embeddingModel: process.env.OPENAI_COMPATIBLE_EMBEDDING_MODEL || null,
    contextWindow: Number(process.env.OPENAI_COMPATIBLE_CONTEXT_WINDOW) || undefined,
  };
}

/**
 * Resolves the openai_compatible provider: an org's api_key connection wins
 * (its key is optional, many local servers ignore auth), then the
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
        // An undecryptable key degrades to keyless, local servers allow it.
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
        contextWindow: connection.config.contextWindow,
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
 * Whether this turn may run on the invoking Member's own consumer subscription
 * (ADR-0007 as amended by #769).
 *
 * Two conditions, both load-bearing. The **surface** must be one the amendment
 * names: their own Preview, or their own Teammate chat. Published Widget
 * traffic never qualifies, and neither does an unattended run, which has no
 * surface and no invoker. The **memberId** must be present, because the
 * capability belongs to a person: the caller advertises only the providers that
 * person's own paired device verified, so an absent invoker means there is
 * nobody whose subscription this could be.
 */
export function mayUsePersonalSubscription(resolution: KeyResolution): boolean {
  return isOperatorSurface(resolution) && Boolean(resolution.memberId);
}

/**
 * Whether this surface may see operator diagnostics: which provider answered,
 * that no credential is configured, where to fix it. Both internal surfaces
 * qualify, because everyone on them is org staff. A Visitor on a published
 * widget never sees a word about the tenant's configuration.
 */
export function isOperatorSurface(resolution: KeyResolution): boolean {
  return resolution.surface === "preview" || resolution.surface === "teammate";
}

function openKey(connection: ProviderConnection | undefined): string | null {
  if (!connection?.encryptedKey) return null;
  try {
    return openSecret(connection.encryptedKey) || null;
  } catch {
    // An undecryptable key is no key: the next source gets its turn.
    return null;
  }
}

function byokCredential(
  provider: CatalogProvider,
  connections: ProviderConnection[]
): ProviderCredential | null {
  const apiKey = openKey(
    connections.find(
      (c) => c.provider === provider && c.type === "api_key" && c.encryptedKey
    )
  );
  return apiKey ? { provider, kind: "api_key", apiKey } : null;
}

function federatedCredential(
  provider: CatalogProvider,
  connections: ProviderConnection[]
): ProviderCredential | null {
  if (provider !== "google") return null;
  const federated = connections.find(
    (c) =>
      c.provider === "google" &&
      c.type === "federated" &&
      c.config.kind === "google_vertex"
  );
  return federated?.config.kind === "google_vertex"
    ? { provider: "google", kind: "google_vertex_federated", config: federated.config }
    : null;
}

function platformCredential(provider: CatalogProvider): ProviderCredential | null {
  const apiKey = process.env[PLATFORM_ENV[provider]];
  return apiKey ? { provider, kind: "platform", apiKey } : null;
}

function orgGatewayConnection(
  connections: ProviderConnection[]
): ProviderConnection | undefined {
  return connections.find(
    (c) => c.provider === "ai_gateway" && c.type === "api_key" && c.encryptedKey
  );
}

/** The Organization's own Gateway key: customer-funded, recorded `ai_gateway`. */
function orgGatewayCredential(
  provider: CatalogProvider,
  connections: ProviderConnection[]
): ProviderCredential | null {
  const apiKey = openKey(orgGatewayConnection(connections));
  return apiKey ? { provider, kind: "ai_gateway", apiKey, route: "gateway" } : null;
}

/** The platform's Gateway key: plan-funded, recorded `platform`. */
function platformGatewayCredential(provider: CatalogProvider): ProviderCredential | null {
  const apiKey = process.env[PLATFORM_GATEWAY_ENV];
  return apiKey ? { provider, kind: "platform", apiKey, route: "gateway" } : null;
}

const SOURCE_RESOLVERS: Record<
  ModelSource,
  (provider: CatalogProvider, connections: ProviderConnection[]) => ProviderCredential | null
> = {
  platform: platformCredential,
  api_key: byokCredential,
  federated: federatedCredential,
  ai_gateway: orgGatewayCredential,
  platform_gateway: platformGatewayCredential,
};

/**
 * Resolves an authenticated provider capability. A Member's explicitly
 * detected local CLI wins only on their own internal surface; otherwise order
 * is the Organization BYOK connection, provider-specific federated credential,
 * platform key, then AI Gateway (the Organization's key, then the platform's).
 * A pinned `resolution.source` answers from that source alone. Legacy database
 * subscription rows remain ignored everywhere.
 */
export function resolveProviderCredential(
  provider: Provider,
  connections: ProviderConnection[],
  resolution: KeyResolution = {}
): ProviderCredential | null {
  if (resolution.allowedProviders && !resolution.allowedProviders.includes(provider))
    return null;
  if (provider === "openai_compatible") {
    // One endpoint, one route: a pinned source other than its own key or the
    // platform env does not exist for it.
    return resolution.source && resolution.source !== "api_key" && resolution.source !== "platform"
      ? null
      : resolveOpenAiCompatibleCredential(connections);
  }
  // A Member's own subscription outranks even a pinned source on their own
  // internal surfaces: it is set once in Settings and "outranks whatever the
  // composer offers" (ADR-0007 as amended by #769).
  if (
    mayUsePersonalSubscription(resolution) &&
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
  if (resolution.source) return SOURCE_RESOLVERS[resolution.source](provider, connections);
  const direct =
    byokCredential(provider, connections) ??
    federatedCredential(provider, connections) ??
    platformCredential(provider);
  if (direct || !resolution.gateway) return direct;
  return orgGatewayCredential(provider, connections) ?? platformGatewayCredential(provider);
}

/**
 * Every source that can serve this exact model now, in resolution order: what
 * a picker offers as tagged entries. The Gateway counts only when it has the
 * model. A Member's personal subscription is not here: it is never a stored
 * choice (ADR-0007 as amended by #769).
 */
export function availableModelSources(
  provider: Provider,
  modelId: string,
  connections: ProviderConnection[]
): ModelSource[] {
  if (provider === "openai_compatible") {
    const credential = resolveOpenAiCompatibleCredential(connections);
    return credential ? [credential.kind === "api_key" ? "api_key" : "platform"] : [];
  }
  const current = currentModelId(provider, modelId);
  return MODEL_SOURCES.filter((source) => {
    const credential = SOURCE_RESOLVERS[source](provider, connections);
    return credential !== null && servable(credential, provider, current) !== null;
  });
}

export function providerAvailability(
  connections: ProviderConnection[]
): Record<
  Provider,
  { platform: boolean; byok: boolean; federated: boolean; gateway: boolean }
> {
  const availability = {} as Record<
    Provider,
    { platform: boolean; byok: boolean; federated: boolean; gateway: boolean }
  >;
  const gateway =
    Boolean(process.env[PLATFORM_GATEWAY_ENV]) || Boolean(orgGatewayConnection(connections));
  for (const provider of ["anthropic", "openai", "google"] as CatalogProvider[]) {
    availability[provider] = {
      platform: Boolean(process.env[PLATFORM_ENV[provider]]),
      byok: connections.some(
        (c) => c.provider === provider && c.type === "api_key" && c.encryptedKey
      ),
      federated: connections.some(
        (c) => c.provider === provider && c.type === "federated"
      ),
      gateway,
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
    gateway: false,
  };
  return availability;
}

/**
 * Every hosted model answers through the capacity retry (`rate-limit-retry.ts`):
 * a 429 from a shared platform key is retried with jitter instead of on the
 * SDK's fixed schedule, so a crowd refused together does not return together.
 * A local CLI subscription has no HTTP status and is left as it is.
 */
export function buildModel(
  provider: Provider,
  modelId: string,
  credential: ProviderCredential
): ReturnType<typeof wrapLanguageModel> {
  // Verified 2026-10-02: Gateway catalog, plus the official GPT-5.1 model page.
  // Bind the ACTUAL resolved model, including provider fallback and retired IDs.
  const known: Record<string, number> = {
    "google/gemini-3.5-flash": 1_000_000,
    "google/gemini-3.5-flash-lite": 1_000_000,
    "google/gemini-2.5-flash-lite": 1_048_576,
    "anthropic/claude-opus-4-8": 1_000_000,
    "anthropic/claude-sonnet-5": 1_000_000,
    "openai/gpt-5.1": 400_000,
    "openai/gpt-5.4-mini": 400_000,
  };
  const verifiedCapacity = async () => credential.provider === "openai_compatible" && "config" in credential
    ? credential.config.contextWindow ?? null
    : known[`${provider}/${modelId}`] ?? (await getRuntimeHost().getSystemDb()?.listPlatformEvalModels())?.find(row => row.provider === provider && row.modelId === modelId)?.contextWindow ?? null;
  const capacity = async () => {
    if (credential.kind === "local_subscription" && !known[`${provider}/${modelId}`]) {
      throw new Error("This local model has no verified maximum output capacity. Select an offered model with a verified context window.");
    }
    const verified = await verifiedCapacity();
    // CLI adapters cannot cap remote output. Reserve the provider maximum
    // (128k for the offered Claude/OpenAI models) plus CLI-owned framing.
    return verified ? verified - (credential.kind === "local_subscription" ? 128000 + 65536 : 0) : null;
  };
  const model = wrapLanguageModel({
    model: credential.kind === "local_subscription"
      ? createLocalSubscriptionModel({ provider: credential.provider, modelId, cliModelId: modelId, run: credential.run })
      : buildHostedModel(provider, modelId, credential),
    middleware: credential.kind === "local_subscription"
      ? contextBudgetMiddleware(capacity)
      : [contextBudgetMiddleware(capacity), capacityRetryMiddleware()],
  });
  bindModelCapacity(model, capacity);
  return model;
}

function buildHostedModel(
  provider: Provider,
  modelId: string,
  credential: Exclude<ProviderCredential, { kind: "local_subscription" }>
) {
  if (isGatewayCredential(credential)) {
    const gatewayId = gatewayModelId(provider, modelId);
    if (!gatewayId) throw new Error(`AI Gateway does not serve ${provider}/${modelId}`);
    return createGateway({ apiKey: credential.apiKey }).languageModel(gatewayId);
  }
  if (credential.provider === "openai_compatible" && "config" in credential) {
    return createOpenAICompatible({
      name: "openai-compatible",
      baseURL: credential.config.baseUrl,
      apiKey: credential.apiKey ?? undefined,
      // A URL an Organization typed in is guarded; the operator's env is not.
      ...(credential.kind === "platform"
        ? {}
        : { fetch: guardedOpenAiCompatibleFetch }),
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

/**
 * How a reserve or classifier model resolves: automatically (a pin names the
 * preferred model's route only), with the Gateway allowed at the end.
 */
function automaticChatResolution(resolution: KeyResolution): KeyResolution {
  return { ...resolution, source: undefined, gateway: true };
}

/** A Gateway credential serves only the models the Gateway has. */
function servable(
  credential: ProviderCredential | null,
  provider: Provider,
  modelId: string
): ProviderCredential | null {
  if (!credential || !isGatewayCredential(credential)) return credential;
  return gatewayModelId(provider, modelId) ? credential : null;
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
  // configured provider in Preview, even when the organization holds an API
  // key or federated credential for it. The Chat-settings default model
  // (resolution.localSubscriptionModel) applied upstream lands on the first
  // branch below; this covers the "Automatic" preference.
  //
  // An EXPLICIT local-model selection must pick its own provider, not merely
  // the first connected one: with both CLIs connected, choosing a Claude model
  // while OpenAI happened to be `localSubscriptionProviders[0]` used to resolve
  // to OpenAI's fallback tier (gpt-5.4-mini) and ignore the selection entirely.
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
  const preferredCredential = servable(
    resolveProviderCredential(preferredProvider, connections, { ...resolution, gateway: true }),
    preferredProvider,
    currentModelId(preferredProvider, preferredModelId)
  );
  if (preferredCredential) {
    // An assistant configured on openai_compatible may leave the model blank
    // (or hold another provider's default): the connection's chat model is
    // the source of truth for what the endpoint serves.
    const modelId =
      preferredCredential.kind === "local_subscription" && preferredCredential.modelId
        ? currentModelId(preferredProvider, preferredCredential.modelId)
        : preferredProvider === "openai_compatible"
        ? configuredModelId(preferredCredential, FALLBACK_MODEL)
        : currentModelId(preferredProvider, preferredModelId);
    return {
      model: buildModel(preferredProvider, modelId, preferredCredential),
      provider: preferredProvider,
      modelId,
      credentialKind: preferredCredential.kind,
      usedFallback: false,
    };
  }
  const fallbackOrder = [
    ...(resolution.fallbackModel ? [resolution.fallbackModel.provider] : []),
    ...orderedLocalProviders(resolution),
    ...(["google", "anthropic", "openai", "openai_compatible"] as Provider[]),
  ].filter(
    (provider, index, providers) =>
      provider !== preferredProvider && providers.indexOf(provider) === index
  );
  // The pin named the preferred model's route; a reserve model resolves
  // automatically, the way it always has.
  const automatic = automaticChatResolution(resolution);
  for (const provider of fallbackOrder) {
    const resolved = resolveProviderCredential(provider, connections, automatic);
    if (!resolved) continue;
    const modelId = resolution.fallbackModel?.provider === provider
      ? resolution.fallbackModel.modelId
      : configuredModelId(resolved, FALLBACK_MODEL);
    const credential = servable(resolved, provider, modelId);
    if (!credential) continue;
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

/**
 * The Assistant answer's configured model and reserve, shared by execution,
 * spend admission, and concurrency admission. A reserve names an answer model;
 * classifier and explicit Eval candidates continue to resolve independently.
 */
export function resolveAssistantChatModel(
  assistant: Pick<Assistant, "modelProvider" | "modelId" | "modelSource" | "tools">,
  connections: ProviderConnection[],
  resolution: KeyResolution = {},
): ResolvedChatModel | null {
  const reserve = assistant.tools.evaluationModels?.fallback;
  const fallbackModel = reserve && reserve.provider !== "typesafe" && reserve.provider !== "voyage"
    ? { provider: reserve.provider, modelId: reserve.modelId }
    : resolution.fallbackModel;
  return resolveChatModel(assistant.modelProvider, assistant.modelId, connections, {
    ...resolution,
    fallbackModel,
    source: assistant.modelSource ?? undefined,
  });
}

export type ResolvedClassifierModel = Omit<ResolvedChatModel, "usedFallback">;

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
    ...(["google", "anthropic", "openai", "openai_compatible"] as Provider[]),
  ].filter((provider, index, providers) => providers.indexOf(provider) === index);
  // A pinned source names the chat model's route, not the classifier's.
  const automatic = automaticChatResolution(resolution);
  for (const provider of order) {
    const resolved = resolveProviderCredential(provider, connections, automatic);
    const modelId = resolved ? configuredModelId(resolved, CLASSIFIER_MODEL) : "";
    const credential = resolved && servable(resolved, provider, modelId);
    if (credential) {
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
