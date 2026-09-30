import { describe, expect, it } from "vitest";
import { groupByDay, historyDayLabel, relativeShort } from "./history-groups";

const now = new Date(2026, 8, 29, 15, 0);

describe("historyDayLabel", () => {
  it("names today and yesterday, and dates the rest", () => {
    expect(historyDayLabel(new Date(2026, 8, 29, 0, 5).toISOString(), now)).toBe("Today");
    expect(historyDayLabel(new Date(2026, 8, 28, 23, 59).toISOString(), now)).toBe("Yesterday");
    expect(historyDayLabel(new Date(2026, 8, 16, 12).toISOString(), now)).toBe("16 Sept 2026");
  });

  it("files an unreadable timestamp under Earlier", () => {
    expect(historyDayLabel("not a date", now)).toBe("Earlier");
  });
});

describe("groupByDay", () => {
  it("sorts newest first and folds each day into one group", () => {
    const at = (day: number, hour: number) => new Date(2026, 8, day, hour).toISOString();
    const groups = groupByDay(
      [
        { id: "old", updatedAt: at(16, 9) },
        { id: "today-early", updatedAt: at(29, 9) },
        { id: "today-late", updatedAt: at(29, 14) },
      ],
      now
    );
    expect(groups.map((group) => group.label)).toEqual(["Today", "16 Sept 2026"]);
    expect(groups[0].entries.map((entry) => entry.id)).toEqual(["today-late", "today-early"]);
    expect(groups[0].id).toBe("day:Today");
  });
});

describe("relativeShort", () => {
  it("counts minutes, hours and days, then falls back to the date", () => {
    const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
    expect(relativeShort(ago(20_000), now)).toBe("Now");
    expect(relativeShort(ago(25 * 60_000), now)).toBe("25m");
    expect(relativeShort(ago(3 * 3_600_000), now)).toBe("3h");
    expect(relativeShort(ago(2 * 86_400_000), now)).toBe("2d");
    expect(relativeShort(new Date(2026, 7, 1).toISOString(), now)).toBe("01 Aug");
    expect(relativeShort("nope", now)).toBe("");
  });
});
