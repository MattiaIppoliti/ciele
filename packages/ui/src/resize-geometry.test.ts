import { describe, expect, it } from "vitest";
import {
  RUBBERBAND_CONSTANT,
  grabOffsetFor,
  resizeWidthFor,
  rubberband,
} from "./resize-geometry";

describe("grabOffsetFor", () => {
  // The handle straddles the panel edge (w-3 at -right-1.5 / -left-1.5), so the
  // pointer lands up to 6px either side of the edge it is dragging.
  it("is the signed distance from the pointer to the edge it moves", () => {
    expect(grabOffsetFor(500, 506)).toBe(6);
    expect(grabOffsetFor(500, 494)).toBe(-6);
  });

  it("is zero when the pointer is exactly on the edge", () => {
    expect(grabOffsetFor(500, 500)).toBe(0);
  });
});

describe("resizeWidthFor", () => {
  const bounds = { minWidth: 200, maxWidth: 800 };

  it("keeps the edge under the pointer, not the pointer under the edge", () => {
    // Grabbed 6px right of a 400px edge: at clientX 450 the edge belongs at 444.
    const width = resizeWidthFor({
      pointer: 450,
      grabOffset: 6,
      anchor: "left",
      ...bounds,
    });
    expect(width).toBe(444);
  });

  it("measures a right-anchored panel back from its own right edge", () => {
    const width = resizeWidthFor({
      pointer: 700,
      grabOffset: -6,
      anchor: "right",
      containerEdge: 1000,
      ...bounds,
    });
    // Edge sits at 706; the panel runs from there to 1000.
    expect(width).toBe(294);
  });

  it("does not move at all when the pointer has not moved off the grab point", () => {
    const start = resizeWidthFor({
      pointer: 406,
      grabOffset: 6,
      anchor: "left",
      ...bounds,
    });
    expect(start).toBe(400);
  });

  it("resists below the lower bound too, when that bound is a wall", () => {
    const width = resizeWidthFor({
      pointer: 50,
      grabOffset: 0,
      anchor: "left",
      ...bounds,
    });
    expect(width).toBeLessThan(200);
    expect(width).toBeGreaterThan(50);
  });

  it("resists past the upper bound instead of stopping dead", () => {
    const width = resizeWidthFor({
      pointer: 1000,
      grabOffset: 0,
      anchor: "left",
      ...bounds,
    });
    // Follows past 800, but never 1:1 and never all the way to the pointer.
    expect(width).toBeGreaterThan(800);
    expect(width).toBeLessThan(1000);
  });

  it("resists further the further past the bound the pointer goes", () => {
    const near = resizeWidthFor({
      pointer: 900,
      grabOffset: 0,
      anchor: "left",
      ...bounds,
    });
    const far = resizeWidthFor({
      pointer: 1600,
      grabOffset: 0,
      anchor: "left",
      ...bounds,
    });
    const nearGain = near - 800;
    const farGain = far - 800;
    // 7x the overshoot must not buy 7x the travel.
    expect(farGain).toBeGreaterThan(nearGain);
    expect(farGain).toBeLessThan(nearGain * 7);
  });

  it("lets the panel travel below min when an overdrag floor is given", () => {
    const width = resizeWidthFor({
      pointer: 100,
      grabOffset: 0,
      anchor: "left",
      overdragTo: 48,
      ...bounds,
    });
    expect(width).toBe(100);
  });

  it("never goes below the overdrag floor", () => {
    const width = resizeWidthFor({
      pointer: 10,
      grabOffset: 0,
      anchor: "left",
      overdragTo: 48,
      ...bounds,
    });
    expect(width).toBe(48);
  });
});

describe("rubberband", () => {
  it("returns nothing for no overshoot", () => {
    expect(rubberband(0, 800)).toBe(0);
  });

  it("is signed, so it resists in both directions", () => {
    expect(rubberband(-100, 800)).toBe(-rubberband(100, 800));
  });

  it("always gives back less than the overshoot", () => {
    for (const overshoot of [10, 50, 200, 1000, 5000]) {
      expect(rubberband(overshoot, 800)).toBeLessThan(overshoot);
    }
  });

  // (x·d·c)/(d + c·x) tends to d as x grows, so one dimension is the hard
  // ceiling: no amount of dragging escapes by more than the panel's own width.
  it("approaches the dimension as a ceiling, never exceeding it", () => {
    expect(rubberband(1_000_000, 800)).toBeLessThan(800);
    expect(rubberband(1_000_000, 800)).toBeGreaterThan(790);
  });

  it("uses the constant to set how hard it resists early on", () => {
    const soft = rubberband(100, 800, 0.9);
    const stiff = rubberband(100, 800, 0.2);
    expect(soft).toBeGreaterThan(stiff);
    expect(RUBBERBAND_CONSTANT).toBe(0.55);
  });
});
