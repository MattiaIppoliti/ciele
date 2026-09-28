import { describe, expect, it } from "vitest";
import { estimateCostEur } from "./pricing";
import type {
  DashboardFacts,
  DashboardTurnFact,
  DashboardUsageFact,
} from "./types";
import {
  DASHBOARD_LATENCY_BOUNDS_MS,
  computeUsageDashboard,
  daysBetween,
  histogramQuantile,
  latencyBucketOf,
  type UsageDashboardFilter,
} from "./usage-dashboard";

const WINDOW: UsageDashboardFilter = {
  from: "2026-09-01",
  to: "2026-09-03",
  surface: "",
  assistantId: "",
};

function usage(overrides: Partial<DashboardUsageFact>): DashboardUsageFact {
  return {
    day: "2026-09-01",
    surface: "widget",
    stage: "generate",
    provider: "google",
    modelId: "gemini-3.5-flash",
    assistantId: "a1",
    calls: 1,
    inputTokens: 1_000_000,
    outputTokens: 0,
    ...overrides,
  };
}

function turn(overrides: Partial<DashboardTurnFact>): DashboardTurnFact {
  return {
    day: "2026-09-01",
    surface: "widget",
    assistantId: "a1",
    status: "succeeded",
    flowName: "Search knowledge",
    errorClass: null,
    latencyBucket: latencyBucketOf(1200),
    turns: 1,
    durationMs: 1200,
    toolCalls: 0,
    ...overrides,
  };
}

function facts(overrides: Partial<DashboardFacts>): DashboardFacts {
  return { usage: [], turns: [], verdicts: [], conversations: [], ...overrides };
}

describe("latencyBucketOf", () => {
  it("puts a duration on a bound into the bucket above it", () => {
    expect(latencyBucketOf(0)).toBe(0);
    expect(latencyBucketOf(249)).toBe(0);
    expect(latencyBucketOf(250)).toBe(1);
    expect(latencyBucketOf(59_999)).toBe(DASHBOARD_LATENCY_BOUNDS_MS.length - 1);
    expect(latencyBucketOf(60_000)).toBe(DASHBOARD_LATENCY_BOUNDS_MS.length);
  });
});

describe("histogramQuantile", () => {
  it("is null for an empty histogram, so a quiet window reads as no data", () => {
    expect(histogramQuantile([0, 0, 0], 0.5)).toBeNull();
  });

  it("interpolates inside the bucket the quantile falls in", () => {
    // Four turns, all in [1000, 1500): the median sits halfway through.
    const counts = new Array(DASHBOARD_LATENCY_BOUNDS_MS.length + 1).fill(0);
    counts[latencyBucketOf(1200)] = 4;
    expect(histogramQuantile(counts, 0.5)).toBe(1250);
  });

  it("reports the open last bucket at its lower bound rather than inventing an upper one", () => {
    const counts = new Array(DASHBOARD_LATENCY_BOUNDS_MS.length + 1).fill(0);
    counts[DASHBOARD_LATENCY_BOUNDS_MS.length] = 3;
    expect(histogramQuantile(counts, 0.95)).toBe(60_000);
  });
});

describe("daysBetween", () => {
  it("is inclusive at both ends and empty when inverted", () => {
    expect(daysBetween("2026-09-29", "2026-10-01")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01"]);
    expect(daysBetween("2026-10-02", "2026-10-01")).toEqual([]);
  });
});

describe("computeUsageDashboard", () => {
  it("prices spend through the one rate table and splits it per day and per model", () => {
    const dashboard = computeUsageDashboard(
      facts({
        usage: [
          usage({}),
          usage({ day: "2026-09-02", modelId: "gemini-2.5-flash-lite", inputTokens: 2_000_000 }),
        ],
      }),
      WINDOW
    );
    const flash = estimateCostEur("google", "gemini-3.5-flash", 1_000_000, 0);
    const lite = estimateCostEur("google", "gemini-2.5-flash-lite", 2_000_000, 0);
    expect(dashboard.totals.spendEur).toBeCloseTo(flash + lite);
    expect(dashboard.daily.map((d) => d.day)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    expect(dashboard.daily[0].spendEur).toBeCloseTo(flash);
    expect(dashboard.daily[2].spendEur).toBe(0);
    expect(dashboard.models[0].modelId).toBe("gemini-3.5-flash");
    expect(dashboard.models.reduce((sum, m) => sum + m.share, 0)).toBeCloseTo(1);
  });

  it("drops rows outside the window", () => {
    const dashboard = computeUsageDashboard(facts({ usage: [usage({ day: "2026-08-31" })] }), WINDOW);
    expect(dashboard.totals.calls).toBe(0);
  });

  it("narrows every card to one surface but keeps the surface split whole", () => {
    const input = facts({
      usage: [
        usage({ surface: "widget" }),
        usage({ surface: "routine", assistantId: null }),
        usage({ surface: "ingestion", stage: "embed", assistantId: null }),
        usage({ surface: null, assistantId: null }),
      ],
      turns: [turn({ surface: "widget" }), turn({ surface: "teammate", assistantId: null })],
    });
    const teammates = computeUsageDashboard(input, { ...WINDOW, surface: "teammates" });
    expect(teammates.totals.calls).toBe(1);
    expect(teammates.totals.turns).toBe(1);
    expect(teammates.surfaces.map((s) => [s.surface, s.calls])).toEqual([
      ["assistants", 1],
      ["teammates", 1],
      ["internal", 1],
      ["unattributed", 1],
    ]);
    // An unattributed row counts only when no surface is picked.
    expect(computeUsageDashboard(input, WINDOW).totals.calls).toBe(4);
    expect(computeUsageDashboard(input, { ...WINDOW, surface: "internal" }).totals.calls).toBe(1);
  });

  it("does not report verifier or escalation numbers for surfaces that have none", () => {
    const input = facts({
      verdicts: [{ day: "2026-09-01", assistantId: "a1", verdict: "pass", count: 3 }],
      conversations: [{ day: "2026-09-01", assistantId: "a1", escalated: true, conversations: 1 }],
    });
    const internal = computeUsageDashboard(input, { ...WINDOW, surface: "internal" });
    expect(internal.totals.evalPassRate).toBeNull();
    expect(internal.totals.autonomyRate).toBeNull();
    const assistants = computeUsageDashboard(input, { ...WINDOW, surface: "assistants" });
    expect(assistants.totals.evalPassRate).toBe(1);
    expect(assistants.totals.autonomyRate).toBe(0);
  });

  it("counts failures, groups them by class and derives the success rate", () => {
    const dashboard = computeUsageDashboard(
      facts({
        turns: [
          turn({ turns: 8 }),
          turn({ status: "failed", errorClass: "provider_timeout", turns: 1, flowName: null }),
          turn({ status: "failed", errorClass: null, turns: 1, flowName: null }),
        ],
      }),
      WINDOW
    );
    expect(dashboard.totals.successRate).toBeCloseTo(0.8);
    expect(dashboard.errors).toEqual([
      { errorClass: "provider_timeout", turns: 1 },
      { errorClass: "unknown", turns: 1 },
    ]);
    expect(dashboard.daily[0].failedTurns).toBe(2);
  });

  it("ranks the five most used Flows against each other per period", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const turns = names.map((flowName, i) => turn({ flowName, turns: 10 - i }));
    // On day two B overtakes A.
    turns.push(turn({ day: "2026-09-02", flowName: "A", turns: 1 }));
    turns.push(turn({ day: "2026-09-02", flowName: "B", turns: 5 }));
    const { flows } = computeUsageDashboard(facts({ turns }), WINDOW);
    expect(flows.granularity).toBe("day");
    expect(flows.series.map((s) => s.name)).toEqual(["B", "A", "C", "D", "E"]);
    const a = flows.series.find((s) => s.name === "A");
    const b = flows.series.find((s) => s.name === "B");
    expect(a?.ranks).toEqual([1, 2, null]);
    expect(b?.ranks).toEqual([2, 1, null]);
  });

  it("switches the Flow ranking to weeks past three weeks of days", () => {
    const { flows } = computeUsageDashboard(
      facts({ turns: [turn({ day: "2026-09-02" })] }),
      { ...WINDOW, from: "2026-09-01", to: "2026-09-30" }
    );
    expect(flows.granularity).toBe("week");
    // 2026-09-01 is a Tuesday; the first period starts on the Monday before.
    expect(flows.periods[0]).toBe("2026-08-31");
  });
});
