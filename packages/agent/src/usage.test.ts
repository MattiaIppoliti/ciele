import { describe, expect, it } from "vitest";
import { recordStreamUsage, usageTotals } from "./usage";

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

describe("recordStreamUsage", () => {
  it("reports the stream's totals to the recorder", async () => {
    const recorded: Array<{ inputTokens: number; outputTokens: number }> = [];
    await recordStreamUsage(
      Promise.resolve({ inputTokens: 12, outputTokens: 7 }),
      (u) => recorded.push(u)
    );
    expect(recorded).toEqual([{ inputTokens: 12, outputTokens: 7 }]);
  });

  it("survives a provider that reports no usage at all", async () => {
    const recorded: unknown[] = [];
    await recordStreamUsage(Promise.resolve(undefined), (u) => recorded.push(u));
    expect(recorded).toEqual([{ inputTokens: 0, outputTokens: 0 }]);
  });

  it("never fails the turn it accounted for", async () => {
    await expect(
      recordStreamUsage(Promise.reject(new Error("no usage")), () => {})
    ).resolves.toBeUndefined();
    await expect(
      recordStreamUsage(Promise.resolve({}), () => {
        throw new Error("ledger down");
      })
    ).resolves.toBeUndefined();
  });

  it("is a no-op without a recorder", async () => {
    await expect(
      recordStreamUsage(Promise.resolve({ inputTokens: 1 }))
    ).resolves.toBeUndefined();
  });
});
