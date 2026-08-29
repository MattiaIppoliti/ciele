import { describe, expect, it } from "vitest";
import { paginationRange } from "./pagination";

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
