import { describe, expect, it } from "vitest";
import type { UsageDailyRow } from "@agent-hub/core";
import { formatCredits, summarizeUsage } from "./usage-summary";

const row = (over: Partial<UsageDailyRow>): UsageDailyRow => ({
  day: "2026-07-20",
  kind: "chat",
  credentialKind: "platform",
  provider: "google",
  modelId: "gemini-3.5-flash",
  calls: 1,
  inputTokens: 0,
  outputTokens: 0,
  units: 0,
  ...over,
});

describe("summarizeUsage", () => {
  it("reports nothing for no usage", () => {
    const summary = summarizeUsage([]);
    expect(summary.byResource.ai).toMatchObject({ calls: 0, credits: 0, platformCredits: 0 });
    expect(summary.byResource.scraping.pages).toBe(0);
    expect(summary.platform).toEqual({ credits: 0, tokens: 0, pages: 0 });
  });

  it("files chat rows under the AI meter and embeddings under their own", () => {
    const summary = summarizeUsage([
      row({ kind: "chat", inputTokens: 1_000, outputTokens: 100 }),
      row({
        kind: "embedding",
        provider: "openai",
        modelId: "text-embedding-3-small",
        inputTokens: 5_000,
      }),
    ]);
    expect(summary.byResource.ai).toMatchObject({
      calls: 1,
      inputTokens: 1_000,
      outputTokens: 100,
    });
    expect(summary.byResource.embedding).toMatchObject({
      calls: 1,
      inputTokens: 5_000,
    });
  });

  it("files a crawl row under scraping, counting pages rather than tokens", () => {
    const summary = summarizeUsage([
      row({ kind: "crawl", provider: "apify", modelId: "", calls: 2, units: 500 }),
    ]);
    expect(summary.byResource.scraping).toMatchObject({
      calls: 2,
      pages: 500,
      inputTokens: 0,
    });
    // 500 Apify pages at €0.002 = €1.00 = 100 credits.
    expect(summary.byResource.scraping.credits).toBeCloseTo(100, 6);
    expect(summary.byResource.ai.calls).toBe(0);
  });

  it("prices each resource in credits", () => {
    const summary = summarizeUsage([
      // 1M flash input = €0.30 = 30 credits.
      row({ inputTokens: 1_000_000 }),
      // 1M embedding tokens = €0.019 = 1.9 credits.
      row({
        kind: "embedding",
        provider: "openai",
        modelId: "text-embedding-3-small",
        inputTokens: 1_000_000,
      }),
      // 100 Apify pages = €0.20 = 20 credits.
      row({ kind: "crawl", provider: "apify", modelId: "", units: 100 }),
    ]);
    expect(summary.byResource.ai.credits).toBeCloseTo(30, 6);
    expect(summary.byResource.embedding.credits).toBeCloseTo(1.9, 6);
    expect(summary.byResource.scraping.credits).toBeCloseTo(20, 6);
  });

  it("leads each meter with the credits a plan actually bounds", () => {
    const summary = summarizeUsage([
      row({ credentialKind: "platform", inputTokens: 1_000_000 }),
      row({ credentialKind: "api_key", inputTokens: 1_000_000 }),
    ]);
    // Both cost 30 credits, but only the platform-funded half counts against a
    // plan — a meter that led with 60 would misstate the allowance consumed.
    expect(summary.byResource.ai.credits).toBeCloseTo(60, 6);
    expect(summary.byResource.ai.platformCredits).toBeCloseTo(30, 6);
  });

  it("splits platform-funded work from work on the customer's own credentials", () => {
    const summary = summarizeUsage([
      row({ credentialKind: "platform", inputTokens: 1_000_000 }),
      row({ credentialKind: "api_key", inputTokens: 1_000_000 }),
      row({ credentialKind: "google_vertex_federated", inputTokens: 1_000_000 }),
    ]);
    expect(summary.platform.tokens).toBe(1_000_000);
    expect(summary.platform.credits).toBeCloseTo(30, 6);
    // Both non-platform kinds are the customer's own cost, so they group.
    expect(summary.own.tokens).toBe(2_000_000);
    expect(summary.own.credits).toBeCloseTo(60, 6);
  });

  it("counts a row with no recorded credential as the customer's, not the platform's", () => {
    // 'unknown' predates credential metering. Attributing it to the platform
    // would overstate what a plan allowance has consumed.
    const summary = summarizeUsage([
      row({ credentialKind: "unknown", inputTokens: 1_000 }),
    ]);
    expect(summary.platform.credits).toBe(0);
    expect(summary.own.credits).toBeGreaterThan(0);
    expect(summary.byResource.ai.platformCredits).toBe(0);
  });

  it("keeps crawled pages out of the token counts on the funding split", () => {
    const summary = summarizeUsage([
      row({ kind: "crawl", provider: "apify", modelId: "", units: 100 }),
    ]);
    expect(summary.platform).toMatchObject({ tokens: 0, pages: 100 });
  });

  it("prices a row with no provider attribution above zero, never as free", () => {
    const summary = summarizeUsage([
      row({ provider: "", modelId: "", inputTokens: 1_000_000 }),
    ]);
    expect(summary.byResource.ai.credits).toBeGreaterThan(0);
  });
});

describe("formatCredits", () => {
  it("shows an exact zero as zero", () => {
    expect(formatCredits(0)).toBe("0");
  });

  it("never rounds real usage down to nothing", () => {
    // One answer is about a quarter of a credit; a page that showed "0" for it
    // would read as free.
    expect(formatCredits(0.04)).toBe("<0.1");
  });

  it("keeps one decimal while the number is small, and drops it when large", () => {
    expect(formatCredits(12.34)).toBe("12.3");
    expect(formatCredits(1_234.5)).toBe("1,235");
  });
});
