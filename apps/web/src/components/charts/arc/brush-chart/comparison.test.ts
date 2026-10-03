import { describe, expect, it } from "vitest";
import { brushComparison } from "./comparison";

const points = [10, 20, 30, 40, 50, 60, 70, 80].map((value) => ({ value }));

describe("brush chart bucket comparisons", () => {
  it("compares weekly conversation counts with the previous week", () => {
    const comparison = brushComparison(points, 7, "week");
    expect(comparison.change).toBeCloseTo(0.142857);
    expect(comparison.comparisonLabel).toBe("vs a week earlier");
    expect(comparison.averageLabel).toBe("7-week average");
  });

  it("compares monthly counts with the previous month and names that interval", () => {
    const comparison = brushComparison(points, 7, "month");
    expect(comparison.change).toBeCloseTo(0.142857);
    expect(comparison.comparisonLabel).toBe("vs a month earlier");
    expect(comparison.averageLabel).toBe("7-month average");
  });

  it("keeps the week-over-week comparison for daily counts", () => {
    expect(brushComparison(points, 7, "day")).toEqual({
      change: 7,
      comparisonLabel: "vs a week earlier",
      averageLabel: "7-day average",
    });
    expect(brushComparison(points, 6, "day").change).toBeNull();
  });

  it("omits a comparison without a selected point or a nonzero baseline", () => {
    expect(brushComparison(points, null, "week").change).toBeNull();
    expect(brushComparison(points, 0, "month").change).toBeNull();
    expect(brushComparison([{ value: 0 }, { value: 80 }], 1, "week").change).toBeNull();
  });
});
