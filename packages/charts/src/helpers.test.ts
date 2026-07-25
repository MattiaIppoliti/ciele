import { describe, expect, it } from "vitest";
import {
  buildSeriesPath,
  clamp,
  interpolateHeight,
  normalizeValues,
  percentChange,
  resolveSectionPalette,
  seriesTotal,
  skeletonHeight,
  toDenseDailySeries,
} from "./helpers";
import type { DotPalette, DotSection } from "./types";

const FALLBACK: DotPalette = { filled: "f", active: "a", topDot: "t" };

describe("clamp", () => {
  it("clamps below, inside and above the range", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe("normalizeValues", () => {
  it("scales values into row counts", () => {
    expect(normalizeValues([0, 5, 10], 10, 10)).toEqual([0, 5, 10]);
  });

  it("returns zeros when max is 0", () => {
    expect(normalizeValues([0, 0], 0, 10)).toEqual([0, 0]);
  });
});

describe("interpolateHeight", () => {
  const normalized = [0, 10];

  it("returns endpoints exactly", () => {
    expect(interpolateHeight(0, 11, normalized)).toBe(0);
    expect(interpolateHeight(10, 11, normalized)).toBe(10);
  });

  it("interpolates the midpoint", () => {
    expect(interpolateHeight(5, 11, normalized)).toBe(5);
  });

  it("degenerates to the first value for single-column charts", () => {
    expect(interpolateHeight(0, 1, [7, 9])).toBe(7);
  });
});

describe("resolveSectionPalette", () => {
  const sections: DotSection[] = [
    { start: 0, end: 0.5, palette: { filled: "1f", active: "1a", topDot: "1t" } },
    { start: 0.5, end: 1, palette: { filled: "2f", active: "2a", topDot: "2t" } },
  ];

  it("picks the section containing the column position", () => {
    expect(resolveSectionPalette(0, 10, sections, FALLBACK).active).toBe("1a");
    expect(resolveSectionPalette(9, 10, sections, FALLBACK).active).toBe("2a");
  });

  it("falls back when no sections are provided", () => {
    expect(resolveSectionPalette(3, 10, undefined, FALLBACK)).toBe(FALLBACK);
    expect(resolveSectionPalette(3, 10, [], FALLBACK)).toBe(FALLBACK);
  });
});

describe("skeletonHeight", () => {
  it("is deterministic and within the row bounds", () => {
    for (let i = 0; i < 50; i++) {
      const h = skeletonHeight(i, 10);
      expect(h).toBe(skeletonHeight(i, 10));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(10);
    }
  });
});

describe("buildSeriesPath", () => {
  it("returns empty for fewer than 2 points", () => {
    expect(buildSeriesPath([5], 10, 9, 4, 90, "stroke")).toBe("");
  });

  it("builds a stroke path starting at the first point", () => {
    const d = buildSeriesPath([0, 10], 10, 9, 4, 94, "stroke");
    expect(d.startsWith("M 2 92")).toBe(true);
    expect(d).toContain("Q");
    expect(d).not.toContain("Z");
  });

  it("closes the area variant down to the x-axis", () => {
    const d = buildSeriesPath([0, 10], 10, 9, 4, 94, "area");
    expect(d.endsWith("Z")).toBe(true);
    expect(d).toContain("L 2 94");
  });
});

describe("toDenseDailySeries", () => {
  const end = new Date(Date.UTC(2026, 6, 10)); // 2026-07-10

  it("zero-fills missing days over the window, sorted ascending", () => {
    const dense = toDenseDailySeries(
      [{ day: "2026-07-09", value: 4 }],
      3,
      end,
    );
    expect(dense).toEqual([
      { day: "2026-07-08", value: 0 },
      { day: "2026-07-09", value: 4 },
      { day: "2026-07-10", value: 0 },
    ]);
  });

  it("sums duplicate day entries (per-org rows)", () => {
    const dense = toDenseDailySeries(
      [
        { day: "2026-07-10", value: 2 },
        { day: "2026-07-10", value: 3 },
      ],
      1,
      end,
    );
    expect(dense).toEqual([{ day: "2026-07-10", value: 5 }]);
  });

  it("drops points outside the window", () => {
    const dense = toDenseDailySeries(
      [{ day: "2026-01-01", value: 99 }],
      2,
      end,
    );
    expect(dense.every((p) => p.value === 0)).toBe(true);
  });
});

describe("seriesTotal / percentChange", () => {
  it("sums point values", () => {
    expect(seriesTotal([{ value: 1 }, { value: 2.5 }])).toBe(3.5);
  });

  it("computes rounded percent change", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(90, 100)).toBe(-10);
    expect(percentChange(101, 300)).toBe(-66.3);
  });

  it("returns null with no baseline", () => {
    expect(percentChange(10, 0)).toBeNull();
  });
});
