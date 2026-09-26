import { describe, expect, it } from "vitest";
import { MAX_BLOCKS, revealDelays } from "./page-reveal-timing";

describe("revealDelays", () => {
  it("starts the first block at once and steps the rest in order", () => {
    expect(revealDelays(4, false)).toEqual([0, 110, 220, 330]);
  });

  it("never lets a long page take longer than the span to finish arriving", () => {
    const delays = revealDelays(40, false);
    expect(delays).toHaveLength(MAX_BLOCKS);
    expect(delays.at(-1)).toBeLessThanOrEqual(800);
  });

  it("compresses the cascade under reduced motion", () => {
    expect(revealDelays(3, true)).toEqual([0, 25, 50]);
  });

  it("has nothing to schedule for an empty page", () => {
    expect(revealDelays(0, false)).toEqual([]);
  });
});
