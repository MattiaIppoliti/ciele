import { describe, expect, it } from "vitest";
import {
  CREDIT_EUR,
  creditsFor,
  estimateCostEur,
  estimateCrawlCostEur,
} from "./pricing";

const MILLION = 1_000_000;

/** The generic rate an unpriced chat model falls back to (pricing.ts). */
const FALLBACK_INPUT_EUR_PER_MILLION = 3;

describe("estimateCostEur — chat models", () => {
  it("prices a catalog model from its own rate", () => {
    // Gemini 3.5 Flash: €0.30 in / €1.20 out per 1M.
    expect(
      estimateCostEur("google", "gemini-3.5-flash", MILLION, MILLION)
    ).toBeCloseTo(1.5, 10);
  });

  it("falls back to the generic rate for a model that is not in the table", () => {
    expect(estimateCostEur("openai", "gpt-retired", MILLION, 0)).toBeCloseTo(
      FALLBACK_INPUT_EUR_PER_MILLION,
      10
    );
  });

  it("prices self-hosted / OpenAI-compatible endpoints at zero", () => {
    expect(estimateCostEur("openai_compatible", "llama-whatever", MILLION, MILLION)).toBe(0);
  });
});

describe("estimateCostEur — embedding models", () => {
  // None of the embedding models the runtime can resolve were in the price
  // table, so every batch was priced at the chat fallback. What that did to the
  // daily AI budget an admin actually reads is asserted at the ledger level in
  // db-contract.suite.ts; these cases pin the rates themselves.
  it.each([
    ["openai", "text-embedding-3-small", 0.019],
    ["google", "text-embedding-005", 0.023],
    ["google", "gemini-embedding-001", 0.14],
  ] as const)("prices %s/%s from its own rate", (provider, modelId, perMillion) => {
    expect(estimateCostEur(provider, modelId, MILLION, 0)).toBeCloseTo(perMillion, 10);
  });

  it("prices an embedding batch two orders of magnitude below the chat fallback", () => {
    const embedding = estimateCostEur("openai", "text-embedding-3-small", 40 * MILLION, 0);
    const fallback = estimateCostEur("openai", "gpt-retired", 40 * MILLION, 0);
    expect(embedding).toBeLessThan(fallback / 100);
  });

  it("charges nothing for output tokens an embedding call never produces", () => {
    expect(estimateCostEur("openai", "text-embedding-3-small", 0, MILLION)).toBe(0);
  });
});

describe("estimateCrawlCostEur", () => {
  it("prices the metered SaaS crawler per page", () => {
    expect(estimateCrawlCostEur("apify", 1_000)).toBeCloseTo(2, 10);
  });

  it("prices the self-hosted worker an order of magnitude below the SaaS crawler", () => {
    const worker = estimateCrawlCostEur("crawl4ai", 1_000);
    const saas = estimateCrawlCostEur("apify", 1_000);
    expect(worker).toBeCloseTo(0.2, 10);
    expect(worker * 10).toBeCloseTo(saas, 10);
  });

  it("prices the in-process local crawler at zero", () => {
    expect(estimateCrawlCostEur("local", 10_000)).toBe(0);
  });

  it("prices an unrecorded crawler at the most expensive known rate, never free", () => {
    const dearest = estimateCrawlCostEur("apify", 500);
    expect(estimateCrawlCostEur(null, 500)).toBeCloseTo(dearest, 10);
    expect(estimateCrawlCostEur(undefined, 500)).toBeCloseTo(dearest, 10);
    expect(estimateCrawlCostEur("some-future-crawler", 500)).toBeCloseTo(dearest, 10);
  });

  it("prices a crawler named after an object prototype member at the same rate", () => {
    // The crawler arrives as free text from the telemetry column, so it can be
    // any string at all. A naive key lookup resolves "constructor" and friends
    // to inherited members and multiplies pages by a function — NaN, which is
    // worse than free: every downstream `used > cap` comparison is false, so a
    // cap would read as never reached.
    const dearest = estimateCrawlCostEur("apify", 500);
    for (const name of ["constructor", "toString", "valueOf", "hasOwnProperty"]) {
      expect(estimateCrawlCostEur(name, 500)).toBeCloseTo(dearest, 10);
    }
  });

  it("costs nothing for a crawl that returned no pages", () => {
    expect(estimateCrawlCostEur("apify", 0)).toBe(0);
  });
});

describe("creditsFor", () => {
  it("values one credit at one euro cent", () => {
    expect(CREDIT_EUR).toBe(0.01);
  });

  it("converts a euro of estimated cost into a hundred credits", () => {
    // 1M output tokens of Claude Opus at €70/1M would be €70; use a group that
    // lands on exactly €1 instead: Gemini 3.5 Flash input at €0.30/1M.
    const credits = creditsFor([
      {
        kind: "model",
        provider: "google",
        modelId: "gemini-3.5-flash",
        inputTokens: 10 * MILLION / 3,
        outputTokens: 0,
      },
    ]);
    expect(credits).toBeCloseTo(100, 6);
  });

  it("converts a crawl group", () => {
    // 1,000 Apify pages = €2.00 = 200 credits.
    expect(creditsFor([{ kind: "crawl", crawler: "apify", pages: 1_000 }])).toBeCloseTo(
      200,
      10
    );
  });

  it("sums mixed groups", () => {
    const credits = creditsFor([
      {
        kind: "model",
        provider: "openai",
        modelId: "text-embedding-3-small",
        inputTokens: MILLION,
        outputTokens: 0,
      },
      { kind: "crawl", crawler: "apify", pages: 100 },
    ]);
    // €0.019 + €0.20 = €0.219 = 21.9 credits.
    expect(credits).toBeCloseTo(21.9, 10);
  });

  it("returns zero for nothing metered", () => {
    expect(creditsFor([])).toBe(0);
  });

  it("keeps credits fractional so a single cheap answer is not rounded away", () => {
    // A typical RAG answer on the default models: ~6k context in, ~400 out.
    const credits = creditsFor([
      {
        kind: "model",
        provider: "google",
        modelId: "gemini-3.5-flash",
        inputTokens: 6_000,
        outputTokens: 400,
      },
    ]);
    expect(credits).toBeGreaterThan(0.2);
    expect(credits).toBeLessThan(0.3);
  });
});
