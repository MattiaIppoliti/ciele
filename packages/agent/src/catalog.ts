import type { Provider } from "@agent-hub/core";

/**
 * Editable catalog of models offered per provider. Client-safe (no node
 * deps). Key order drives the provider picker's dropdown order, Google
 * comes first as the platform default for this deployment.
 */
export const MODEL_CATALOG: Record<Provider, { id: string; label: string }[]> = {
  google: [
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
  ],
  anthropic: [
    { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
  openai: [
    { id: "gpt-5.1", label: "GPT-5.1" },
    { id: "gpt-5.1-mini", label: "GPT-5.1 mini" },
  ],
  // No static catalog: the endpoint serves whatever the connection's
  // free-text chat model names (#436). Pickers hide empty-catalog providers.
  openai_compatible: [],
};

export const PROVIDER_NAMES: Record<Provider, string> = {
  google: "Google",
  anthropic: "Anthropic",
  openai: "OpenAI",
  openai_compatible: "OpenAI-compatible",
};
