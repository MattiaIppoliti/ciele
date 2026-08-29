import { describe, expect, it } from "vitest";
import { gaugeRingGeometry, ringDash } from "./gauge";

describe("ringDash", () => {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;

  it("draws nothing at zero", () => {
    const dash = ringDash(0, radius);
    expect(dash.circumference).toBeCloseTo(circumference, 6);
    expect(dash.dashOffset).toBeCloseTo(circumference, 6);
  });

  it("draws the whole ring at one", () => {
    expect(ringDash(1, radius).dashOffset).toBeCloseTo(0, 6);
  });

  it("draws half the ring at a half", () => {
    expect(ringDash(0.5, radius).dashOffset).toBeCloseTo(circumference / 2, 6);
  });

  it("clamps past the end rather than winding round twice", () => {
    // Usage can exceed a cap; the ring is full, never overdrawn.
    expect(ringDash(2.5, radius).dashOffset).toBeCloseTo(0, 6);
  });

  it("clamps a negative fraction to empty", () => {
    expect(ringDash(-1, radius).dashOffset).toBeCloseTo(circumference, 6);
  });

  it("treats a non-finite fraction as empty rather than drawing NaN", () => {
    // A cap of zero divided into usage yields Infinity upstream; an SVG with
    // NaN in its dash offset renders nothing at all, silently.
    expect(ringDash(Number.NaN, radius).dashOffset).toBeCloseTo(circumference, 6);
    expect(ringDash(Number.POSITIVE_INFINITY, radius).dashOffset).toBeCloseTo(0, 6);
  });
});

describe("gaugeRingGeometry", () => {
  it("nests rings from the outside in, and keeps them inside the box", () => {
    const rings = gaugeRingGeometry(2, { size: 96, strokeWidth: 8, gap: 4 });
    expect(rings).toHaveLength(2);
    expect(rings[0].radius).toBeGreaterThan(rings[1].radius);
    for (const ring of rings) {
      // The stroke straddles the radius, so the outer edge must still fit.
      expect(ring.radius + ring.strokeWidth / 2).toBeLessThanOrEqual(48);
      expect(ring.radius).toBeGreaterThan(0);
    }
  });

  it("puts the centre of the box at half the size", () => {
    expect(gaugeRingGeometry(1, { size: 120, strokeWidth: 10, gap: 4 })[0].center).toBe(60);
  });

  it("separates rings by the requested gap", () => {
    const [outer, inner] = gaugeRingGeometry(2, { size: 96, strokeWidth: 8, gap: 6 });
    expect(outer.radius - inner.radius).toBeCloseTo(8 + 6, 6);
  });

  it("never produces a negative radius, however many rings are asked for", () => {
    // Defensive: a caller adding a third window must get a degenerate-but-valid
    // geometry rather than an SVG that throws.
    for (const ring of gaugeRingGeometry(6, { size: 40, strokeWidth: 8, gap: 4 })) {
      expect(ring.radius).toBeGreaterThan(0);
    }
  });
});
