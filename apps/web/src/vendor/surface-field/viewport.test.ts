import { describe, expect, it } from "vitest";
import {
  PARALLAX_MAX,
  PARALLAX_MIN,
  advanceLattice,
  normalizeViewport,
  parallaxScale,
  pickZoomAnchor,
  sameLattice,
  seedLattice,
  zoomFixedPoint,
  type SurfaceFieldLattice,
  type SurfaceFieldPoint,
  type SurfaceFieldViewport,
} from "./viewport";

/* The screen x of the centre of the dot with floor index `k`. */
const dotX = (l: SurfaceFieldLattice, k: number) => l.originX + l.step / 2 + (k - l.firstCol) * l.step;
const dotY = (l: SurfaceFieldLattice, k: number) => l.originY + l.step / 2 + (k - l.firstRow) * l.step;

/* A camera zoomed by `factor` about screen point `p`, as React Flow does for a wheel. */
const zoomAbout = (v: SurfaceFieldViewport, p: SurfaceFieldPoint, factor: number): SurfaceFieldViewport => ({
  x: p.x - (p.x - v.x) * factor,
  y: p.y - (p.y - v.y) * factor,
  zoom: v.zoom * factor,
});

/* Carries a floor along a camera path the way the component does. */
const carry = (gap: number, path: SurfaceFieldViewport[], pointer: SurfaceFieldPoint | null = null) => {
  let lattice = seedLattice(gap, path[0]);
  const frames = [lattice];
  for (let i = 1; i < path.length; i++) {
    const anchor = pickZoomAnchor(zoomFixedPoint(path[i - 1], path[i]), pointer, 800, 600);
    lattice = advanceLattice(lattice, gap, path[i - 1], path[i], anchor);
    frames.push(lattice);
  }
  return frames;
};

describe("normalizeViewport", () => {
  it("falls back to identity values for missing or degenerate numbers", () => {
    expect(normalizeViewport(undefined)).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(normalizeViewport({ x: Number.NaN, y: Infinity, zoom: 0 })).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(normalizeViewport({ x: 3, y: 4, zoom: -2 })).toEqual({ x: 3, y: 4, zoom: 1 });
    expect(normalizeViewport({ x: 3, y: 4, zoom: 1e9 }).zoom).toBe(1e3);
    expect(normalizeViewport({ x: 3, y: 4, zoom: 1e-9 }).zoom).toBe(1e-3);
  });
});

describe("seedLattice", () => {
  it("is exactly the historical grid at the identity viewport", () => {
    for (const gap of [22, 17.5, 6, 40]) {
      const l = seedLattice(gap, { x: 0, y: 0, zoom: 1 });
      expect(l).toEqual({ scale: 1, step: gap, originX: 0, originY: 0, firstCol: 0, firstRow: 0 });
    }
  });

  it("keeps the origin in (-step, 0] wherever the camera is", () => {
    for (const v of [{ x: 13, y: -7, zoom: 1 }, { x: -1000.25, y: 333, zoom: 1.75 }, { x: 5e6, y: -5e6, zoom: 0.2 }]) {
      const l = seedLattice(22, v);
      expect(l.originX).toBeLessThanOrEqual(0);
      expect(l.originX).toBeGreaterThan(-l.step);
      expect(l.originY).toBeLessThanOrEqual(0);
      expect(l.originY).toBeGreaterThan(-l.step);
    }
  });
});

describe("parallaxScale", () => {
  it("compresses zoom and clamps the spacing", () => {
    expect(parallaxScale(1)).toBe(1);
    expect(parallaxScale(2)).toBeCloseTo(2 ** 0.4, 12);
    expect(parallaxScale(0.5)).toBeCloseTo(0.5 ** 0.4, 12);
    expect(parallaxScale(1e-3)).toBe(PARALLAX_MIN);
    expect(parallaxScale(0.3)).toBe(PARALLAX_MIN);
    expect(parallaxScale(5)).toBe(PARALLAX_MAX);
    expect(parallaxScale(1e3)).toBe(PARALLAX_MAX);
    for (let zoom = 1e-3; zoom < 1e3; zoom *= 1.1) {
      const l = seedLattice(22, { x: 0, y: 0, zoom });
      expect(l.step).toBeGreaterThanOrEqual(22 * PARALLAX_MIN - 1e-9);
      expect(l.step).toBeLessThanOrEqual(22 * PARALLAX_MAX + 1e-9);
    }
  });
});

describe("advanceLattice", () => {
  it("pans exactly: a camera moved by d moves every dot by d, at any zoom", () => {
    for (const zoom of [0.2, 0.7, 1, 2.5, 8]) {
      const a: SurfaceFieldViewport = { x: -4321.5, y: 987.25, zoom };
      const b: SurfaceFieldViewport = { x: a.x + 37.3, y: a.y - 12.9, zoom };
      const la = carry(22, [{ x: 0, y: 0, zoom }, a])[1];
      const lb = advanceLattice(la, 22, a, b, { x: 400, y: 300 });
      expect(lb.step).toBe(la.step);
      for (const k of [la.firstCol, la.firstCol + 5]) expect(dotX(lb, k) - dotX(la, k)).toBeCloseTo(37.3, 9);
      for (const k of [la.firstRow, la.firstRow + 5]) expect(dotY(lb, k) - dotY(la, k)).toBeCloseTo(-12.9, 9);
    }
  });

  it("pans by whole cells without moving the origin, only the floor index", () => {
    const a = seedLattice(22, { x: 0, y: 0, zoom: 1 });
    const b = advanceLattice(a, 22, { x: 0, y: 0, zoom: 1 }, { x: 44, y: -22, zoom: 1 }, { x: 0, y: 0 });
    expect(b.originX).toBeCloseTo(a.originX, 9);
    expect(b.firstCol).toBe(-2);
    expect(b.firstRow).toBe(1);
    expect(sameLattice(a, b)).toBe(false);
  });

  it("scales the floor by the parallax ratio about the zoom anchor", () => {
    const p = { x: 500, y: 250 };
    const a: SurfaceFieldViewport = { x: -20000, y: 15000, zoom: 1 };
    const b = zoomAbout(a, p, 1.5);
    const la = carry(22, [{ x: 0, y: 0, zoom: 1 }, a])[1];
    const lb = advanceLattice(la, 22, a, b, pickZoomAnchor(zoomFixedPoint(a, b), null, 800, 600));
    const q = parallaxScale(1.5) / parallaxScale(1);
    expect(lb.step).toBeCloseTo(22 * q, 12);
    for (const k of [la.firstCol, la.firstCol + 9, la.firstCol + 30]) {
      expect(dotX(lb, k)).toBeCloseTo(p.x + (dotX(la, k) - p.x) * q, 6);
    }
  });

  it("has no discontinuity: across the whole zoom range no dot jumps in one small step", () => {
    const gap = 22;
    const p = { x: 431, y: 287 };
    /* A world origin far off screen, where the plain `x mod step` would slide
       the dots under the pointer by many cells per step. */
    const path: SurfaceFieldViewport[] = [{ x: -73000.5, y: 41000.25, zoom: 0.05 }];
    for (let i = 0; i < 400; i++) path.push(zoomAbout(path[path.length - 1], p, 1.02));
    for (let i = 0; i < 400; i++) path.push(zoomAbout(path[path.length - 1], p, 1 / 1.02));
    const frames = carry(gap, path);
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1];
      const b = frames[i];
      /* The dot nearest the anchor moves by at most 2% of its distance to it. */
      const k = a.firstCol + Math.round((p.x - a.originX - a.step / 2) / a.step);
      const j = a.firstRow + Math.round((p.y - a.originY - a.step / 2) / a.step);
      expect(Math.abs(dotX(b, k) - dotX(a, k))).toBeLessThanOrEqual(0.02 * a.step + 1e-6);
      expect(Math.abs(dotY(b, j) - dotY(a, j))).toBeLessThanOrEqual(0.02 * a.step + 1e-6);
      /* And every dot on screen moves by under 1% of its distance from the
         anchor for a 2% zoom step: a smooth scale, never a wrap to the next cell. */
      for (const kk of [a.firstCol, a.firstCol + 20, a.firstCol + 40]) {
        expect(Math.abs(dotX(b, kk) - dotX(a, kk))).toBeLessThanOrEqual(0.01 * Math.abs(dotX(a, kk) - p.x) + 1e-6);
      }
    }
    /* Past both clamps the floor stops scaling but still pans with the anchor. */
    expect(frames[0].step).toBeCloseTo(gap * PARALLAX_MIN, 12);
    expect(frames[400].step).toBeCloseTo(gap * PARALLAX_MAX, 12);
  });

  it("stays exact when a zoom and a pan land in one frame and the fixed point is off the canvas", () => {
    const a: SurfaceFieldViewport = { x: 100, y: 50, zoom: 1 };
    const pointer = { x: 300, y: 200 };
    const b: SurfaceFieldViewport = { ...zoomAbout(a, pointer, 1.1) };
    b.x += 400; // a pan on top: the fixed point leaves the box
    const fixed = zoomFixedPoint(a, b)!;
    expect(fixed.x < 0 || fixed.x > 800).toBe(true);
    const anchor = pickZoomAnchor(fixed, pointer, 800, 600);
    expect(anchor).toEqual(pointer);
    const la = seedLattice(22, a);
    const lb = advanceLattice(la, 22, a, b, anchor);
    /* The floor under the pointer moves exactly as the graph under it does: by the pan. */
    const q = parallaxScale(1.1);
    const k = la.firstCol + 3;
    expect(dotX(lb, k)).toBeCloseTo(pointer.x + (dotX(la, k) - pointer.x) * q + 400, 6);
  });
});

describe("zoom anchor inference", () => {
  it("recovers the screen point a zoom kept fixed", () => {
    for (const p of [{ x: 0, y: 0 }, { x: 412.5, y: 97 }, { x: -50, y: 900 }]) {
      for (const factor of [1.001, 1.3, 0.5]) {
        const a: SurfaceFieldViewport = { x: -812.25, y: 3000, zoom: 0.83 };
        const fixed = zoomFixedPoint(a, zoomAbout(a, p, factor))!;
        expect(fixed.x).toBeCloseTo(p.x, 4);
        expect(fixed.y).toBeCloseTo(p.y, 4);
      }
    }
  });

  it("is null for a pan, however far", () => {
    expect(zoomFixedPoint({ x: 0, y: 0, zoom: 1.5 }, { x: 900, y: -40, zoom: 1.5 })).toBeNull();
    expect(zoomFixedPoint({ x: 0, y: 0, zoom: 1.5 }, { x: 9, y: 4, zoom: 1.5 * (1 + 1e-9) })).toBeNull();
  });

  it("falls back to the pointer, then to the centre, when the fixed point is not on the canvas", () => {
    expect(pickZoomAnchor({ x: 10, y: 20 }, { x: 1, y: 1 }, 800, 600)).toEqual({ x: 10, y: 20 });
    expect(pickZoomAnchor({ x: -10, y: 20 }, { x: 1, y: 1 }, 800, 600)).toEqual({ x: 1, y: 1 });
    expect(pickZoomAnchor(null, { x: 1, y: 1 }, 800, 600)).toEqual({ x: 1, y: 1 });
    expect(pickZoomAnchor({ x: 5000, y: 20 }, null, 800, 600)).toEqual({ x: 400, y: 300 });
    expect(pickZoomAnchor(null, null, 800, 600)).toEqual({ x: 400, y: 300 });
  });
});
