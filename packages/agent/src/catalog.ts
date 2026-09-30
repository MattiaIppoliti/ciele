import type { ModelSource, Provider } from "@agent-hub/core";

/**
 * Editable catalog of models offered per provider. Client-safe (no node
 * deps). Key order drives the provider picker's dropdown order, Google
 * comes first as the platform default for this deployment.
 */
export const MODEL_CATALOG: Record<Provider, { id: string; label: string }[]> = {
  google: [
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
  ],
  anthropic: [
    { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  ],
  openai: [
    { id: "gpt-5.1", label: "GPT-5.1" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
  ],
  // No static catalog: the endpoint serves whatever the connection's
  // free-text chat model names (#436). Pickers hide empty-catalog providers.
  openai_compatible: [],
};

/**
 * Models Ciele no longer runs, and what runs in their place. An Assistant
 * saved with one keeps its row, so the runtime maps the id here rather than
 * trusting the row: Haiku 4.5 is retired from Ciele, `gpt-5.1-mini` was never
 * an OpenAI model, and Gemini 3.1 Flash Lite gave way to 3.5. Pricing keeps
 * their rows, because usage already recorded against them is still priced.
 */
export const RETIRED_MODELS: Partial<Record<Provider, Readonly<Record<string, string>>>> = {
  anthropic: { "claude-haiku-4-5": "claude-sonnet-5" },
  openai: { "gpt-5.1-mini": "gpt-5.4-mini" },
  google: { "gemini-3.1-flash-lite": "gemini-3.5-flash-lite" },
};

/**
 * What AI Gateway calls each built-in model, checked against its public catalog
 * (`https://ai-gateway.vercel.sh/v1/models`, September 2026). Explicit because
 * the two naming schemes disagree (`claude-opus-4-8` is `claude-opus-4.8`
 * there), and null where the Gateway does not serve the model at all.
 */
const GATEWAY_MODEL_IDS: Record<
  Exclude<Provider, "openai_compatible">,
  Readonly<Record<string, string | null>>
> = {
  google: {
    "gemini-3.5-flash": "google/gemini-3.5-flash",
    "gemini-3.5-flash-lite": "google/gemini-3.5-flash-lite",
    "gemini-2.5-flash-lite": "google/gemini-2.5-flash-lite",
  },
  anthropic: {
    "claude-opus-4-8": "anthropic/claude-opus-4.8",
    "claude-sonnet-5": "anthropic/claude-sonnet-5",
  },
  openai: {
    // The Gateway lists only GPT-5.1's codex and thinking variants.
    "gpt-5.1": null,
    "gpt-5.4-mini": "openai/gpt-5.4-mini",
  },
};

/**
 * The Gateway's name for a model, or null when it cannot serve it. A model
 * outside the built-in table is one a platform owner added from the Gateway's
 * own catalog, whose id is already the Gateway's, so it maps to itself.
 */
export function gatewayModelId(provider: Provider, modelId: string): string | null {
  if (provider === "openai_compatible") return null;
  const table = GATEWAY_MODEL_IDS[provider];
  return Object.hasOwn(table, modelId) ? (table[modelId] ?? null) : `${provider}/${modelId}`;
}

/** The model a configured id runs today: itself, or a retired id's successor. */
export function currentModelId(provider: Provider, modelId: string): string {
  return RETIRED_MODELS[provider]?.[modelId] ?? modelId;
}

/**
 * One row of a chat window's model picker: everything the client needs to draw
 * it and nothing it could act on. The `selector` is the only value that travels
 * back, and it selects from this list rather than naming a model of its own.
 *
 * Declared here, beside the catalogue it is built from, because it is the one
 * half of the model-picker vocabulary a client component reads; the function
 * that builds it needs the Organization's connections and stays server-side
 * (`model-options.ts`).
 */
export interface ChatModelOption {
  selector: string;
  provider: Provider;
  modelId: string;
  /** The catalogue's display name ("Claude Sonnet 5"). */
  label: string;
  /** The provider's display name, for the second line and the icon. */
  providerName: string;
  /** Set when the choice is pinned to one source; absent is automatic. */
  source?: ModelSource;
  /** The tag a picker shows beside a pinned choice ("AI Gateway"). */
  sourceName?: string;
  /**
   * Listed but not askable: no connection of the Organization serves it. Only
   * a surface that shows the whole catalogue sets it (Ciele AI), so a Member
   * sees what exists and what is missing; `chatModelOptions` never does.
   */
  unavailable?: boolean;
}

/**
 * The tag for each model source. A Member's personal subscription has a tag
 * too, for the local-model rows a Preview or Teammate composer draws, even
 * though it is never a stored source.
 */
export const MODEL_SOURCE_NAMES: Record<ModelSource | "subscription", string> = {
  platform: "Platform plan",
  api_key: "API key",
  federated: "Keyless",
  ai_gateway: "AI Gateway · your key",
  platform_gateway: "AI Gateway · platform",
  subscription: "Personal subscription",
};

export const PROVIDER_NAMES: Record<Provider, string> = {
  google: "Google",
  anthropic: "Anthropic",
  openai: "OpenAI",
  openai_compatible: "OpenAI-compatible",
};
