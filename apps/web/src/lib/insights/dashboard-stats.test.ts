import { describe, expect, it } from "vitest";
import { computeUsageDashboard, type DashboardFacts } from "@agent-hub/core";
import { activityStats, carryForward, costStats, observabilityStats } from "./dashboard-stats";

const FILTER = { from: "2026-09-01", to: "2026-09-03", surface: "" as const, assistantId: "" };

function facts(overrides: Partial<DashboardFacts> = {}): DashboardFacts {
  return { usage: [], turns: [], verdicts: [], conversations: [], ...overrides };
}

const turn = (day: string, status: "succeeded" | "failed", turns: number) => ({
  day,
  surface: "widget" as const,
  assistantId: "a1",
  status,
  flowName: null,
  errorClass: status === "failed" ? "provider_timeout" : null,
  latencyBucket: 3,
  turns,
  durationMs: turns * 1200,
  toolCalls: 0,
});

describe("carryForward", () => {
  it("fills a gap with the last known value and a leading gap with the first", () => {
    expect(carryForward([null, 2, null, 5, null])).toEqual([2, 2, 2, 5, 5]);
    expect(carryForward([null, null])).toEqual([0, 0]);
  });
});

describe("costStats", () => {
  it("compares against the previous period and reports no comparison without one", () => {
    const dashboard = computeUsageDashboard(
      facts({
        usage: [
          {
            day: "2026-09-02",
            surface: "widget",
            stage: "generate",
            provider: "google",
            modelId: "gemini-3.5-flash",
            assistantId: "a1",
            calls: 3,
            inputTokens: 1_000_000,
            outputTokens: 0,
          },
        ],
      }),
      FILTER
    );
    const [spend, , calls] = costStats(dashboard, null);
    expect(spend.previous).toBeNull();
    expect(spend.series).toHaveLength(3);
    expect(spend.goodWhen).toBe("down");
    expect(calls.goodWhen).toBe("neutral");
    expect(calls.value).toBe(3);
    const withPrevious = costStats(dashboard, { ...dashboard.totals, calls: 6 });
    expect(withPrevious[2].previous).toBe(6);
  });
});

describe("observabilityStats", () => {
  it("drops the Assistant-only cards when the filter leaves them nothing to measure", () => {
    const dashboard = computeUsageDashboard(facts({ turns: [turn("2026-09-01", "succeeded", 3)] }), FILTER);
    const keys = observabilityStats(dashboard, null).map((s) => s.key);
    expect(keys).not.toContain("accuracy");
    expect(keys).not.toContain("autonomy");
    expect(keys).toContain("success");
  });

  it("builds the success-rate sparkline per day, carrying quiet days forward", () => {
    const dashboard = computeUsageDashboard(
      facts({ turns: [turn("2026-09-01", "succeeded", 3), turn("2026-09-01", "failed", 1), turn("2026-09-03", "succeeded", 2)] }),
      FILTER
    );
    const success = observabilityStats(dashboard, null).find((s) => s.key === "success");
    expect(success?.series).toEqual([75, 75, 100]);
    expect(success?.value).toBeCloseTo(83.33, 1);
  });
});

describe("activityStats", () => {
  it("rates failures per day, carries quiet days, and compares against the week before", () => {
    const dashboard = computeUsageDashboard(
      facts({
        turns: [turn("2026-09-01", "succeeded", 3), turn("2026-09-01", "failed", 1), turn("2026-09-03", "succeeded", 4)],
      }),
      FILTER
    );
    const [turns, failure, p95] = activityStats(dashboard, null);
    expect(turns).toMatchObject({ value: 8, series: [4, 0, 4], goodWhen: "neutral", previous: null });
    expect(failure.value).toBeCloseTo(12.5);
    expect(failure.series).toEqual([25, 25, 0]);
    expect(failure.goodWhen).toBe("down");
    expect(p95.goodWhen).toBe("down");
    const compared = activityStats(dashboard, { ...dashboard.totals, turns: 4, failedTurns: 2 });
    expect(compared[0].previous).toBe(4);
    expect(compared[1].previous).toBe(50);
  });
});
