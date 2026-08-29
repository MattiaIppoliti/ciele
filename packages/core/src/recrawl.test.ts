import { describe, expect, it } from "vitest";
import { effectivePageSchedule, nextCrawlDue } from "./recrawl";

describe("nextCrawlDue", () => {
  const last = "2026-07-01T09:00:00.000Z";

  it("returns null for the 'never' schedule", () => {
    expect(nextCrawlDue("never", last)).toBeNull();
  });

  it("returns null when the source has never been crawled", () => {
    expect(nextCrawlDue("daily", null)).toBeNull();
    expect(nextCrawlDue("weekly", null)).toBeNull();
  });

  it("adds one day for the daily schedule", () => {
    expect(nextCrawlDue("daily", last)).toBe("2026-07-02T09:00:00.000Z");
  });

  it("adds seven days for the weekly schedule", () => {
    expect(nextCrawlDue("weekly", last)).toBe("2026-07-08T09:00:00.000Z");
  });

  it("adds one calendar month for the monthly schedule", () => {
    expect(nextCrawlDue("monthly", last)).toBe("2026-08-01T09:00:00.000Z");
    // month rollover across year boundary
    expect(nextCrawlDue("monthly", "2026-12-15T00:00:00.000Z")).toBe(
      "2027-01-15T00:00:00.000Z"
    );
  });

  it("clamps end-of-month anchors to the target month's last day", () => {
    // Jan 31 + 1 month must land on Feb 28 (2026 is not a leap year), not Mar 3.
    expect(nextCrawlDue("monthly", "2026-01-31T00:00:00.000Z")).toBe(
      "2026-02-28T00:00:00.000Z"
    );
    // Aug 31 → Sep 30 (September has 30 days).
    expect(nextCrawlDue("monthly", "2026-08-31T00:00:00.000Z")).toBe(
      "2026-09-30T00:00:00.000Z"
    );
  });

  it("returns null for an unparseable last-crawled timestamp", () => {
    expect(nextCrawlDue("daily", "not-a-date")).toBeNull();
  });
});

describe("effectivePageSchedule", () => {
  it("uses the page's own schedule when set", () => {
    expect(effectivePageSchedule("daily", "weekly")).toBe("daily");
    expect(effectivePageSchedule("never", "weekly")).toBe("never");
  });

  it("inherits the site schedule when the page schedule is null", () => {
    expect(effectivePageSchedule(null, "weekly")).toBe("weekly");
    expect(effectivePageSchedule(null, "never")).toBe("never");
  });
});
