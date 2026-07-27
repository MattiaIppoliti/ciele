import type { Provider, ResolvedWebsiteCrawlerProvider } from "./types";

/**
 * What the platform's own work costs, and the one conversion from cost into
 * **credits** — the unit plans are denominated in (#504).
 *
 * Two rate tables live here, both EUR list prices and both estimates rather
 * than billed amounts: Ciele has no per-call cost feed from any provider, so
 * every euro figure in the product is a projection from counts, never an
 * invoice reconciliation. Whoever owns the AI budget should revisit these rates
 * when a provider's price list changes or a model/crawler is added.
 *
 * Denominating plan allowances in cost rather than tokens or pages is
 * deliberate: it makes a plan's margin independent of which model an
 * Organization runs. A frontier model burns an allowance faster; it does not
 * quietly cost the business more than the plan collects.
 */
interface ModelPriceEur {
  inputPerMillion: number;
  outputPerMillion: number;
}

/**
 * Per-model EUR price per 1M tokens: the chat models from MODEL_CATALOG
 * (packages/agent/src/catalog.ts) and the embedding models the retrieval
 * layer can resolve (packages/agent/src/embeddings.ts). Embedding models
 * belong in the same table as chat models because both are metered as model
 * calls through one ledger; they simply never produce output tokens.
 */
const PRICING: Record<Provider, Record<string, ModelPriceEur>> = {
  anthropic: {
    "claude-opus-4-8": { inputPerMillion: 14, outputPerMillion: 70 },
    "claude-sonnet-5": { inputPerMillion: 2.8, outputPerMillion: 14 },
    "claude-haiku-4-5": { inputPerMillion: 0.75, outputPerMillion: 3.7 },
  },
  openai: {
    "gpt-5.1": { inputPerMillion: 4.5, outputPerMillion: 13.5 },
    "gpt-5.1-mini": { inputPerMillion: 0.9, outputPerMillion: 3.6 },
    "text-embedding-3-small": { inputPerMillion: 0.02, outputPerMillion: 0 },
  },
  google: {
    "gemini-3.5-flash": { inputPerMillion: 0.3, outputPerMillion: 1.2 },
    "gemini-3.1-flash-lite": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
    "gemini-2.5-flash-lite": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
    "text-embedding-005": { inputPerMillion: 0.025, outputPerMillion: 0 },
    "gemini-embedding-001": { inputPerMillion: 0.15, outputPerMillion: 0 },
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

/**
 * EUR per crawled page, by the crawler that actually ran. Apify is metered
 * per result and is the real marginal cost; the Crawl4AI worker is a fixed
 * container, so its per-page figure is an amortization rather than a bill; the
 * local crawler runs in-process and costs nothing beyond the function
 * invocation the request already pays for.
 */
const CRAWL_PAGE_EUR: Record<ResolvedWebsiteCrawlerProvider, number> = {
  apify: 0.002,
  crawl4ai: 0.0002,
  local: 0,
};

/**
 * Rate for a crawler we cannot identify (a legacy run with no recorded
 * provider, or one added since this table). Deliberately the most expensive
 * known rate, never free: an unpriced unit of work must cost too much rather
 * than nothing, or a gap in attribution becomes a gap in the cap.
 */
const MOST_EXPENSIVE_CRAWL_PAGE_EUR = Math.max(...Object.values(CRAWL_PAGE_EUR));

/**
 * Estimated EUR cost of a crawl, given the crawler that ran and its usable page
 * count.
 *
 * The crawler arrives as free text (the telemetry column is unconstrained), so
 * it may be any string. The lookup is validated by the *value* rather than by
 * the key on purpose: a key test would resolve inherited members —
 * `"constructor"`, `"toString"` — and multiply pages by a function, yielding
 * NaN. NaN is worse than free, because it makes every downstream `used > cap`
 * comparison false and a cap would read as never reached.
 */
export function estimateCrawlCostEur(
  crawler: string | null | undefined,
  pages: number
): number {
  const rate = CRAWL_PAGE_EUR[crawler as ResolvedWebsiteCrawlerProvider];
  return pages * (typeof rate === "number" ? rate : MOST_EXPENSIVE_CRAWL_PAGE_EUR);
}

/**
 * Whether a crawler costs nothing to run — today only the in-process local one.
 * Named so callers can say what they mean: exempting a crawl from a spend cap is
 * about there being nothing to spend, not about which crawler happens to be free.
 * An unidentifiable crawler is never free (see the rate above), so this fails
 * closed.
 */
export function isFreeCrawler(crawler: string | null | undefined): boolean {
  return estimateCrawlCostEur(crawler, 1) === 0;
}

/**
 * One credit is one euro cent of estimated platform cost. Plans are sold as a
 * number of credits per resource per window, so this constant is the bridge
 * between the rate tables above and every cap, gauge and allowance.
 */
export const CREDIT_EUR = 0.01;

/**
 * One group of metered platform work: either a (provider, model) token group —
 * the grain the usage rollup aggregates to — or a (crawler, pages) group from
 * a completed crawl.
 */
export type MeteredUnit =
  | {
      kind: "model";
      provider: Provider;
      modelId: string;
      inputTokens: number;
      outputTokens: number;
    }
  | { kind: "crawl"; crawler: string | null | undefined; pages: number };

/**
 * Credits consumed by the given metered work — the single conversion every
 * consumer of this package shares (cap enforcement and the org Usage page), so
 * the two can never disagree about what something cost. The staff console
 * cannot share it: that app deliberately does not use this package (see
 * its own CLAUDE.md) and prices through its own service-role reads.
 *
 * Credits stay fractional on purpose: one answer on the default models is
 * around a quarter of a credit, and rounding at this layer would meter it as
 * free. Round for display at the surface, never here.
 */
export function creditsFor(units: MeteredUnit[]): number {
  const eur = units.reduce(
    (sum, unit) =>
      sum +
      (unit.kind === "model"
        ? estimateCostEur(
            unit.provider,
            unit.modelId,
            unit.inputTokens,
            unit.outputTokens
          )
        : estimateCrawlCostEur(unit.crawler, unit.pages)),
    0
  );
  return eur / CREDIT_EUR;
}
