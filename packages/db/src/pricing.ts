import type { Provider } from "./types";

/**
 * EUR list price per 1M tokens, by provider + model (from MODEL_CATALOG in
 * apps/web/src/lib/runtime/catalog.ts). These are estimates, not billed
 * amounts — Ciele has no per-call cost feed from any provider, so the daily
 * euro budget is a projection from token counts, not an invoice reconciliation.
 * Whoever owns the AI budget should revisit these rates when provider price
 * lists change or a new model is added to the catalog.
 */
interface ModelPriceEur {
  inputPerMillion: number;
  outputPerMillion: number;
}

const PRICING: Record<Provider, Record<string, ModelPriceEur>> = {
  anthropic: {
    "claude-opus-4-8": { inputPerMillion: 14, outputPerMillion: 70 },
    "claude-sonnet-5": { inputPerMillion: 2.8, outputPerMillion: 14 },
    "claude-haiku-4-5": { inputPerMillion: 0.75, outputPerMillion: 3.7 },
  },
  openai: {
    "gpt-5.1": { inputPerMillion: 4.5, outputPerMillion: 13.5 },
    "gpt-5.1-mini": { inputPerMillion: 0.9, outputPerMillion: 3.6 },
  },
  google: {
    "gemini-3.5-flash": { inputPerMillion: 0.3, outputPerMillion: 1.2 },
    "gemini-3.1-flash-lite": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
    "gemini-2.5-flash-lite": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  },
  // Arbitrary self-chosen endpoints (Ollama, vLLM, gateways): no provider
  // price list exists, and self-hosted models have no per-token bill — the
  // euro budget projects zero for them (the token budget still applies).
  openai_compatible: {},
};

/** Used for a provider/model pair not in the table above (retired or renamed). */
const FALLBACK_PRICE: ModelPriceEur = { inputPerMillion: 3, outputPerMillion: 15 };
const FREE_PRICE: ModelPriceEur = { inputPerMillion: 0, outputPerMillion: 0 };

/** Estimated EUR cost of one model call, given its resolved provider/model and token counts. */
export function estimateCostEur(
  provider: Provider,
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  const price =
    PRICING[provider]?.[modelId] ??
    (provider === "openai_compatible" ? FREE_PRICE : FALLBACK_PRICE);
  return (
    (inputTokens * price.inputPerMillion + outputTokens * price.outputPerMillion) /
    1_000_000
  );
}
