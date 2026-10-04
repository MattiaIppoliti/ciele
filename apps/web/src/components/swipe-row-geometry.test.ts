import { describe, expect, it } from "vitest";
import { clamp, rubber, unrubber, velocityOf, project } from "./swipe-row-geometry";
describe("swipe geometry", () => {
  it("keeps elastic overflow continuous and invertible on either side", () => {
    for (const width of [220, 288, 390]) for (const resistance of [0.05, 0.55, 1]) {
      let previous = -Infinity;
      for (const displacement of [-500, -100, -10, 0, 10, 100, 500]) {
        const exposed = rubber(displacement, width, resistance);
        expect(exposed).toBeGreaterThan(previous);
        expect(Math.abs(exposed)).toBeLessThan(width);
        expect(unrubber(exposed, width, resistance)).toBeCloseTo(displacement, 6);
        previous = exposed;
      }
    }
  });
  it("handles stationary/repeated samples and preserves flick direction", () => {
    expect(velocityOf([])).toBe(0);
    expect(velocityOf([[100, 10]])).toBe(0);
    expect(velocityOf([[100, 10], [100, 10]])).toBe(0);
    expect(velocityOf([[100, 0], [200, 80]])).toBe(800);
    expect(velocityOf([[100, 80], [200, 0]])).toBe(-800);
    expect(project(800)).toBeGreaterThan(0);
    expect(clamp(2000, -1500, 1500)).toBe(1500);
  });
});
