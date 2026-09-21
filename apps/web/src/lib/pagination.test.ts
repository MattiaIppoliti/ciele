import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  clampPageSize,
  countLabel,
  pageWindow,
  paginationRange,
} from "./pagination";

describe("paginationRange", () => {
  it("shows every page when there are 7 or fewer", () => {
    expect(paginationRange(1, 1)).toEqual([1]);
    expect(paginationRange(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("windows near the start with a trailing ellipsis", () => {
    expect(paginationRange(1, 8)).toEqual([1, 2, 3, 4, 5, "ellipsis", 8]);
  });

  it("windows near the end with a leading ellipsis", () => {
    expect(paginationRange(8, 8)).toEqual([1, "ellipsis", 4, 5, 6, 7, 8]);
  });

  it("shows ellipses on both sides in the middle", () => {
    expect(paginationRange(6, 12)).toEqual([1, "ellipsis", 5, 6, 7, "ellipsis", 12]);
  });

  it("never emits a page outside 1..total", () => {
    for (const item of paginationRange(1, 20)) {
      if (item !== "ellipsis") {
        expect(item).toBeGreaterThanOrEqual(1);
        expect(item).toBeLessThanOrEqual(20);
      }
    }
  });
});

describe("pageWindow", () => {
  it("reports the slice on screen, not the page arithmetic", () => {
    expect(pageWindow(1, 25, 132)).toEqual({ from: 1, to: 25, total: 132, pageCount: 6 });
    // The last page is short: `to` is the total, not page * pageSize.
    expect(pageWindow(6, 25, 132)).toEqual({ from: 126, to: 132, total: 132, pageCount: 6 });
  });

  it("reports 0-0 for an empty table rather than 1-0", () => {
    expect(pageWindow(1, 25, 0)).toEqual({ from: 0, to: 0, total: 0, pageCount: 1 });
  });

  it("clamps a page past the end back onto the last one", () => {
    expect(pageWindow(99, 10, 12)).toEqual({ from: 11, to: 12, total: 12, pageCount: 2 });
    expect(pageWindow(0, 10, 12).from).toBe(1);
  });
});

describe("clampPageSize", () => {
  it("accepts only the sizes the footer offers", () => {
    expect(clampPageSize("10")).toBe(10);
    expect(clampPageSize(100)).toBe(100);
  });

  it("falls back to the default for anything else", () => {
    // A hand-typed ?size= must not turn one navigation into a table scan.
    expect(clampPageSize("100000")).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize("abc")).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe("countLabel", () => {
  it("singularizes on one", () => {
    expect(countLabel(1, "campaign")).toBe("1 campaign");
    expect(countLabel(2, "campaign")).toBe("2 campaigns");
    expect(countLabel(0, "campaign")).toBe("0 campaigns");
    expect(countLabel(3, "entry", "entries")).toBe("3 entries");
  });
});
