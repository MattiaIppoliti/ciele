import { describe, expect, it } from "vitest";
import { DEFAULT_RANGE_DAYS, lastDaysRange, trailingRangeDays, utcDay } from "./range";

describe("lastDaysRange", () => {
  it("counts both ends, so 30 days is today and the 29 before it", () => {
    const range = lastDaysRange(30, new Date("2026-09-27T12:00:00Z"));
    expect(range).toEqual({ from: "2026-08-29", to: "2026-09-27" });
    expect(trailingRangeDays(range.from, range.to, "2026-09-27")).toBe(30);
  });

  it("takes the UTC day whatever the clock's local zone would say", () => {
    // 23:30 UTC is already tomorrow east of Greenwich; the range must not be.
    expect(lastDaysRange(1, new Date("2026-09-27T23:30:00Z"))).toEqual({
      from: "2026-09-27",
      to: "2026-09-27",
    });
    expect(utcDay(new Date("2026-09-28T00:00:00Z"))).toBe("2026-09-28");
  });
});

describe("trailingRangeDays", () => {
  it("matches no preset when the range does not end today", () => {
    expect(trailingRangeDays("2026-08-29", "2026-09-26", "2026-09-27")).toBeNull();
  });

  it("refuses an empty or inverted range", () => {
    expect(trailingRangeDays("", "2026-09-27", "2026-09-27")).toBeNull();
    expect(trailingRangeDays("2026-09-28", "2026-09-27", "2026-09-27")).toBeNull();
  });

  it("is what the default window reports, so a fresh visit reads as the preset", () => {
    const now = new Date("2026-03-29T01:00:00Z");
    const { from, to } = lastDaysRange(DEFAULT_RANGE_DAYS, now);
    expect(trailingRangeDays(from, to, utcDay(now))).toBe(DEFAULT_RANGE_DAYS);
  });
});
