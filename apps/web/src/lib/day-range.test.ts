import { describe, expect, it } from "vitest";
import { dayRangeFromSearchParams, isCalendarDay } from "./day-range";

const FALLBACK = { from: "2026-08-29", to: "2026-09-27" };

function range(query: string, maxDays?: number) {
  return dayRangeFromSearchParams(new URLSearchParams(query), FALLBACK, { maxDays });
}

describe("isCalendarDay", () => {
  it("accepts a real day and refuses one that only looks like it", () => {
    expect(isCalendarDay("2026-02-28")).toBe(true);
    expect(isCalendarDay("2028-02-29")).toBe(true);
    expect(isCalendarDay("2026-02-31")).toBe(false);
    expect(isCalendarDay("2026-13-01")).toBe(false);
    expect(isCalendarDay("2026-9-1")).toBe(false);
    expect(isCalendarDay(null)).toBe(false);
  });
});

describe("dayRangeFromSearchParams", () => {
  it("falls back per end, so one bad end keeps the other", () => {
    expect(range("")).toEqual(FALLBACK);
    expect(range("from=2026-09-01&to=2026-02-31")).toEqual({
      from: "2026-09-01",
      to: "2026-09-27",
    });
  });

  it("swaps an inverted range", () => {
    expect(range("from=2026-09-10&to=2026-09-01")).toEqual({
      from: "2026-09-01",
      to: "2026-09-10",
    });
  });

  it("caps a long range at its end only when asked to", () => {
    expect(range("from=2020-01-01&to=2026-09-27", 366).from).toBe("2025-09-27");
    expect(range("from=2020-01-01&to=2026-09-27").from).toBe("2020-01-01");
  });

  it("reads a Next.js searchParams record as well", () => {
    expect(
      dayRangeFromSearchParams({ from: ["2026-09-02", "x"], to: "2026-09-03" }, FALLBACK),
    ).toEqual({ from: "2026-09-02", to: "2026-09-03" });
  });
});
