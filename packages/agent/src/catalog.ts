import type { Provider } from "@agent-hub/core";

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
}

export const PROVIDER_NAMES: Record<Provider, string> = {
  google: "Google",
  anthropic: "Anthropic",
  openai: "OpenAI",
  openai_compatible: "OpenAI-compatible",
};
