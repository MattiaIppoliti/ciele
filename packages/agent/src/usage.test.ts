import { describe, expect, it } from "vitest";
import { recordStreamUsage, turnUsageAttribution, usageTotals } from "./usage";

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

describe("turnUsageAttribution", () => {
  it("uses the surface the subject implies when the caller declares none", () => {
    expect(
      turnUsageAttribution({ subjectSurface: "widget" }).surface
    ).toBe("widget");
    expect(
      turnUsageAttribution({ subjectSurface: "preview", memberId: "m-1" }).surface
    ).toBe("preview");
  });

  it("lets the caller's declared surface win over the subject's", () => {
    // An unattended Routine looks exactly like a Member's Teammate chat from
    // inside the turn; only the caller knows it is driving.
    const { surface, spenders } = turnUsageAttribution({
      subjectSurface: "teammate",
      teammateId: "t-ada",
      declared: { surface: "routine", routineId: "r-1" },
    });
    expect(surface).toBe("routine");
    expect(spenders.routineId).toBe("r-1");
    expect(spenders.teammateId).toBe("t-ada");
  });

  it("names the Member from the same resolution that decides whose keys may run", () => {
    const { spenders } = turnUsageAttribution({
      subjectSurface: "preview",
      memberId: "m-mattia",
    });
    expect(spenders.memberId).toBe("m-mattia");
  });

  it("carries the API key a machine caller arrived on", () => {
    const { spenders } = turnUsageAttribution({
      subjectSurface: "widget",
      declared: { surface: "api", apiKeyId: "k-1" },
    });
    expect(spenders.apiKeyId).toBe("k-1");
  });

  it("nulls every identity it was not given, never leaves it undefined", () => {
    // The two data-layer adapters must agree about what "nobody" is.
    const { spenders } = turnUsageAttribution({ subjectSurface: "widget" });
    expect(spenders).toEqual({
      teammateId: null,
      memberId: null,
      routineId: null,
      apiKeyId: null,
      // The Flow is filled in at row-build time, once one has answered. It is
      // still spelled out here: the rule is every identity, not most of them.
      flowId: null,
    });
  });
});
