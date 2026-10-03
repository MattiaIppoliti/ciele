import { describe, expect, it } from "vitest";
import type { DashboardDay } from "@agent-hub/core";
import {
  dashboardFilterFromSearchParams,
  dashboardWindow,
  defaultDashboardFilter,
  previousPeriodFilter,
} from "./dashboard-filter";
import {
  formatDuration,
  formatEur,
  latencyBucketLabel,
  tokenHighlights,
} from "./dashboard-view";

const NOW = new Date("2026-09-27T21:00:00Z");

function day(date: string, tokens: number): DashboardDay {
  return {
    day: date,
    spendEur: 0,
    spendBySurface: { assistants: 0, teammates: 0, internal: 0, unattributed: 0 },
    calls: 0,
    inputTokens: tokens,
    outputTokens: 0,
    turns: 0,
    failedTurns: 0,
    latencyP50Ms: null,
    latencyP95Ms: null,
    passes: 0,
    fails: 0,
    conversations: 0,
    escalated: 0,
  };
}

describe("dashboardFilterFromSearchParams", () => {
  it("defaults to the last 30 UTC days, today included", () => {
    expect(defaultDashboardFilter(NOW)).toEqual({
      from: "2026-08-29",
      to: "2026-09-27",
      surface: "",
      assistantId: "",
    });
  });

  it("swaps an inverted range and caps one past a year at its end", () => {
    const swapped = dashboardFilterFromSearchParams(new URLSearchParams("from=2026-09-10&to=2026-09-01"), NOW);
    expect([swapped.from, swapped.to]).toEqual(["2026-09-01", "2026-09-10"]);
    const long = dashboardFilterFromSearchParams(new URLSearchParams("from=2020-01-01&to=2026-09-27"), NOW);
    expect(long.from).toBe("2025-09-27");
  });

  it("rejects an unknown surface and drops an Assistant beside Teammates", () => {
    expect(dashboardFilterFromSearchParams(new URLSearchParams("surface=everything"), NOW).surface).toBe("");
    const teammates = dashboardFilterFromSearchParams(new URLSearchParams("surface=teammates&assistantId=a1"), NOW);
    expect(teammates).toMatchObject({ surface: "teammates", assistantId: "" });
    const assistants = dashboardFilterFromSearchParams(new URLSearchParams("surface=assistants&assistantId=a1"), NOW);
    expect(assistants.assistantId).toBe("a1");
  });

  it("covers the inclusive days as a half-open window of instants", () => {
    expect(dashboardWindow({ from: "2026-09-01", to: "2026-09-30", surface: "", assistantId: "" })).toEqual({
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-10-01T00:00:00.000Z",
    });
  });
});

describe("previousPeriodFilter", () => {
  it("is the period of equal length ending the day before, across a month edge", () => {
    const previous = previousPeriodFilter({ from: "2026-09-01", to: "2026-09-30", surface: "teammates", assistantId: "" });
    expect(previous).toEqual({ from: "2026-08-02", to: "2026-08-31", surface: "teammates", assistantId: "" });
    expect(previousPeriodFilter({ from: "2026-09-27", to: "2026-09-27", surface: "", assistantId: "" })).toMatchObject({
      from: "2026-09-26",
      to: "2026-09-26",
    });
  });
});

describe("formatters", () => {
  it("keeps sub-cent spend visible instead of rounding it to free", () => {
    expect(formatEur(0.0037)).toBe("€0.0037");
    expect(formatEur(0)).toBe("€0.00");
    expect(formatEur(711.7416)).toBe("€711.74");
  });

  it("reads durations at the unit that suits them", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(2440)).toBe("2.4 s");
    expect(formatDuration(66_000)).toBe("1.1 min");
  });

  it("labels latency buckets, writing a shared unit once", () => {
    expect(latencyBucketLabel({ fromMs: 0, toMs: 250, turns: 0 })).toBe("<250 ms");
    expect(latencyBucketLabel({ fromMs: 250, toMs: 500, turns: 0 })).toBe("250–500 ms");
    expect(latencyBucketLabel({ fromMs: 500, toMs: 1000, turns: 0 })).toBe("500 ms–1 s");
    expect(latencyBucketLabel({ fromMs: 1000, toMs: 1500, turns: 0 })).toBe("1–1.5 s");
    expect(latencyBucketLabel({ fromMs: 60_000, toMs: null, turns: 0 })).toBe("≥60 s");
  });
});

describe("tokenHighlights", () => {
  it("names the peak day and the busiest weekday, and reports none on a silent window", () => {
    const highlights = tokenHighlights([day("2026-09-07", 10), day("2026-09-08", 40), day("2026-09-14", 35)]);
    expect(highlights.peakDay).toBe("2026-09-08");
    expect(highlights.busiestWeekday).toBe("Monday");
    expect(highlights.averageTokens).toBeCloseTo(85 / 3);
    expect(tokenHighlights([day("2026-09-07", 0)]).peakDay).toBeNull();
  });
});
