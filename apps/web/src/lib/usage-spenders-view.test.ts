import { describe, expect, it } from "vitest";
import type { UsageSpenderRow } from "@agent-hub/core";
import {
  SPENDERS_PER_SECTION,
  spenderBreakdownView,
} from "./usage-spenders-view";

function row(over: Partial<UsageSpenderRow> = {}): UsageSpenderRow {
  return {
    spenders: {},
    assistantId: null,
    surface: null,
    credentialKind: "platform",
    provider: "google",
    modelId: "gemini-2.5-flash",
    calls: 1,
    inputTokens: 1_000_000,
    outputTokens: 0,
    units: 0,
    ...over,
  };
}

describe("spenderBreakdownView", () => {
  it("shows a section only for dimensions that name somebody", () => {
    const sections = spenderBreakdownView([
      row({ spenders: { teammateId: "t-ada" } }),
    ]);
    expect(sections.map((s) => s.dimension)).toEqual(["teammate"]);
  });

  it("keeps the unattributed entry inside a section that has one named spender", () => {
    const sections = spenderBreakdownView([
      row({ spenders: { teammateId: "t-ada" } }),
      row(),
    ]);
    const [teammates] = sections;
    expect(teammates.entries.map((e) => e.label)).toContain("Unattributed");
    // The section still adds up to what the window spent on it.
    const summed = teammates.entries.reduce((sum, e) => sum + e.credits, 0);
    expect(summed).toBeCloseTo(teammates.credits);
  });

  it("labels a spender from the map and reports an unknown id as deleted", () => {
    const [section] = spenderBreakdownView(
      [
        row({ spenders: { teammateId: "t-ada" } }),
        row({ spenders: { teammateId: "t-gone" } }),
      ],
      { teammate: { "t-ada": "Ada" } }
    );
    const labels = section.entries.map((e) => e.label);
    expect(labels).toContain("Ada");
    // The ledger carries no foreign key on purpose, so a retired Teammate's
    // spend is still reported rather than rendered as a raw id or dropped.
    expect(labels).toContain("Deleted teammate");
  });

  it("folds everything past the top few into one row that keeps the total", () => {
    const rows = Array.from({ length: SPENDERS_PER_SECTION + 3 }, (_, i) =>
      row({ spenders: { memberId: `m-${i}` }, inputTokens: 1_000_000 * (i + 1) })
    );
    const [section] = spenderBreakdownView(rows);
    expect(section.entries).toHaveLength(SPENDERS_PER_SECTION + 1);
    expect(section.entries.at(-1)?.label).toBe("3 more");
    const summed = section.entries.reduce((sum, e) => sum + e.credits, 0);
    expect(summed).toBeCloseTo(section.credits);
  });

  it("reports each entry's share of its own section", () => {
    const [section] = spenderBreakdownView([
      row({ spenders: { memberId: "m-1" }, inputTokens: 3_000_000 }),
      row({ spenders: { memberId: "m-2" }, inputTokens: 1_000_000 }),
    ]);
    expect(section.entries[0].fraction).toBeCloseTo(0.75);
    expect(section.entries[1].fraction).toBeCloseTo(0.25);
  });

  it("splits platform-funded spend from the customer's own per entry", () => {
    const [section] = spenderBreakdownView([
      row({ spenders: { memberId: "m-1" } }),
      row({ spenders: { memberId: "m-1" }, credentialKind: "api_key" }),
    ]);
    const [entry] = section.entries;
    expect(entry.platformCredits).toBeCloseTo(entry.ownCredits);
    expect(entry.credits).toBeCloseTo(entry.platformCredits * 2);
  });

  it("returns nothing at all when no row names a spender", () => {
    expect(spenderBreakdownView([row(), row()])).toEqual([]);
  });
});
