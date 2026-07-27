import { describe, expect, it } from "vitest";
import { usageTotals } from "./usage";

describe("usageTotals", () => {
  it("reads the flat result-level shape (generateObject / streamText totals)", () => {
    expect(usageTotals({ inputTokens: 120, outputTokens: 45 })).toEqual({
      inputTokens: 120,
      outputTokens: 45,
    });
  });

  it("flattens the nested model-level usage object", () => {
    expect(
      usageTotals({
        inputTokens: { total: 120, noCache: 100, cacheRead: 20 },
        outputTokens: { total: 45, text: 40, reasoning: 5 },
      })
    ).toEqual({ inputTokens: 120, outputTokens: 45 });
  });

  it("meters zero when usage is missing or partial (never throws)", () => {
    expect(usageTotals(undefined)).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(usageTotals(null)).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(usageTotals({})).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(usageTotals({ inputTokens: { total: 7 } })).toEqual({
      inputTokens: 7,
      outputTokens: 0,
    });
    expect(usageTotals({ inputTokens: {}, outputTokens: {} })).toEqual({
      inputTokens: 0,
      outputTokens: 0,
    });
  });
});
