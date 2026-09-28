import { describe, expect, it } from "vitest";
import { computeUsageDashboard, type Flow, type Source } from "@agent-hub/core";
import { flowsInRoutingOrder, pointsDelta, qualityRows, recentSources } from "./assistant-overview";

const source = (id: string, createdAt: string, name = id): Source =>
  ({ id, name, kind: "file", status: "ready", createdAt, updatedAt: createdAt }) as Source;

const flow = (name: string, position: number, isDefault = false): Flow =>
  ({ id: name, name, position, isDefault, enabled: true, builtIn: false }) as Flow;

describe("recentSources", () => {
  it("lists the newest first across collections, once each", () => {
    const shared = source("s2", "2026-09-20T10:00:00Z");
    const list = recentSources(
      [
        [source("s1", "2026-09-01T10:00:00Z"), shared],
        [shared, source("s3", "2026-09-25T10:00:00Z")],
      ],
      5
    );
    expect(list.map((s) => s.id)).toEqual(["s3", "s2", "s1"]);
    expect(recentSources([[source("a", "2026-09-01T00:00:00Z"), source("b", "2026-09-02T00:00:00Z")]], 1)).toHaveLength(1);
  });
});

describe("flowsInRoutingOrder", () => {
  it("keeps the router's order and puts the Default behavior last", () => {
    const ordered = flowsInRoutingOrder([flow("Default behavior", 0, true), flow("B", 2), flow("A", 1)]);
    expect(ordered.map((f) => f.name)).toEqual(["A", "B", "Default behavior"]);
  });
});

describe("qualityRows", () => {
  const totals = computeUsageDashboard(
    { usage: [], turns: [], verdicts: [], conversations: [] },
    { from: "2026-09-01", to: "2026-09-07", surface: "assistants", assistantId: "a1" }
  ).totals;

  it("carries the counts behind each rate and last week's rate", () => {
    const rows = qualityRows(
      { ...totals, successRate: 0.9, succeededTurns: 9, failedTurns: 1, conversations: 4, escalated: 1, autonomyRate: 0.75 },
      { ...totals, successRate: 0.8 }
    );
    expect(rows.map((r) => r.key)).toEqual(["success", "accuracy", "autonomy"]);
    expect(rows[0]).toMatchObject({ rate: 0.9, previousRate: 0.8, good: 9, bad: 1 });
    expect(rows[2]).toMatchObject({ good: 3, bad: 1 });
    expect(rows[1].rate).toBeNull();
    expect(qualityRows(totals, null)[0].previousRate).toBeNull();
  });
});

describe("pointsDelta", () => {
  it("reads a change of rate in points, and nothing without a comparison", () => {
    expect(pointsDelta(0.55, 0.5)).toBe("\u2191 5.0 pts");
    expect(pointsDelta(0.876, 0.9)).toBe("\u2193 2.4 pts");
    expect(pointsDelta(0.9, 0.9)).toBe("No change");
    expect(pointsDelta(0.9, null)).toBeNull();
    expect(pointsDelta(null, 0.9)).toBeNull();
  });
});
