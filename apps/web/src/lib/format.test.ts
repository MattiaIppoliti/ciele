import { describe, expect, it } from "vitest";
import {
  formatCount,
  formatDateTime,
  formatDay,
  formatEur,
  formatPercent,
  formatShortDay,
  formatStat,
  formatTime,
} from "./format";

describe("UTC date formatting", () => {
  it("keeps the existing day and date-time output", () => {
    const timestamp = "2026-07-03T07:44:00.000Z";

    expect(formatDay(timestamp)).toBe("03 Jul 2026");
    expect(formatShortDay(timestamp)).toBe("3 Jul");
    expect(formatDateTime(timestamp)).toBe("03 Jul 26 07:44");
  });

  it("formats the clock time in UTC, 24-hour", () => {
    expect(formatTime("2026-07-03T19:05:00.000Z")).toBe("19:05");
  });

  it("accepts epoch milliseconds and Date values", () => {
    const ms = Date.parse("2026-07-03T07:44:00.000Z");

    expect(formatDateTime(ms)).toBe("03 Jul 26 07:44");
    expect(formatDay(new Date(ms))).toBe("03 Jul 2026");
  });
});

describe("count formatting", () => {
  it("groups thousands the same way on server and browser", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(0)).toBe("0");
  });
});

describe("stat formatting", () => {
  it("groups integers and keeps at most one decimal", () => {
    expect(formatStat(12345)).toBe("12,345");
    expect(formatStat(2.46)).toBe("2.5");
    expect(formatStat(3)).toBe("3");
  });

  it("spells a 0-100 rate with one percent sign and no space", () => {
    expect(formatPercent(42)).toBe("42%");
    expect(formatPercent(12.34)).toBe("12.3%");
  });
});

describe("euro formatting", () => {
  it("prints a fixed number of decimals, two by default", () => {
    expect(formatEur(1234.5)).toBe("€1,234.50");
    expect(formatEur(15)).toBe("€15.00");
    expect(formatEur(0.025, 3)).toBe("€0.025");
    expect(formatEur(0.03, 3)).toBe("€0.030");
  });
});
