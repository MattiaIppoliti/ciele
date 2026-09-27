/* ═══ THE GRID IS A FLOOR BELOW THE GRAPH, THE LIGHT BELONGS TO THE SCREEN ══
   .
   A host that pans and zooms (React Flow, any canvas editor) draws its nodes
   at `world * zoom + offset`. A dot grid that stayed put while the nodes slid
   over it would read as a window sticker, so the grid PANS 1:1 with the
   camera: move the camera by d screen px and every dot moves by d.
   .
   It does NOT zoom 1:1. Spacing `gap * zoom` has no bottom, and the level of
   detail it needed (drop every other row and column, fade the ones about to
   go) left a grid that at most zooms was half dots at full ink and half dots
   stuck part-way through a fade, with the line fabric broken across them. So
   the grid is a FLOOR some way below the nodes: they scale by `zoom`, it
   scales by a compressed `s` (see `parallaxScale`), the way a far plane moves
   less than a near one. Every zoom draws the same dots, the same lines and
   the same opacity; only their spacing breathes a little.
   .
   Everything else stays in screen pixels: the cursor light, the rings, the
   scene rectangles and the footprints. Those describe where a HAND or a
   rendered element is, and the host already hands them over measured.
   .
   This module is the only place that knows the mapping. The renderer asks it
   for a lattice and then walks cells exactly as it always did, so the identity
   viewport is bit for bit the field it was before viewports existed. */

export type SurfaceFieldViewport = {
  /** Screen x, in CSS px relative to the field root, of world x = 0. */
  x: number;
  /** Screen y, in CSS px relative to the field root, of world y = 0. */
  y: number;
  /** Screen px per world px. */
  zoom: number;
};

export const IDENTITY_VIEWPORT: SurfaceFieldViewport = Object.freeze({ x: 0, y: 0, zoom: 1 });

/* Far outside anything a canvas editor offers (React Flow ships 0.5 to 2);
   the floor's own scale is clamped long before either end. This clamp only
   keeps the ratio between two cameras finite for a host that sends a
   degenerate number. */
const ZOOM_MIN = 1e-3;
const ZOOM_MAX = 1e3;

/** A viewport with finite numbers and a positive zoom. Anything else falls back to identity values. */
export function normalizeViewport(viewport: Partial<SurfaceFieldViewport> | null | undefined): SurfaceFieldViewport {
  if (!viewport) return IDENTITY_VIEWPORT;
  const x = Number.isFinite(viewport.x) ? viewport.x! : 0;
  const y = Number.isFinite(viewport.y) ? viewport.y! : 0;
  const raw = viewport.zoom;
  const zoom = typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, raw))
    : 1;
  return { x, y, zoom };
}

export function sameViewport(a: SurfaceFieldViewport, b: SurfaceFieldViewport): boolean {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}

/* ═══ HOW MUCH THE FLOOR SCALES WHEN THE GRAPH SCALES BY `zoom` ═══════════
   .
   `s = clamp(zoom ^ 0.4, 0.7, 1.6)`. The exponent is the depth of the floor:
   1 would glue it to the nodes (and bring back the unbounded density), 0
   would make it a sticker again. At 0.4 a doubling of zoom is a 1.32x step
   of the grid, which still reads unmistakably as "closer" while the nodes
   visibly outrun it, and a halving is 0.76x.
   .
   The clamps are where the floor stops following at all. 0.7 is a 15.4px
   spacing at the default 22px gap, about twice the dots of zoom 1 and still
   over four dot diameters of daylight between neighbours; the power reaches
   it at zoom 0.41, so React Flow's default minimum (0.5) never quite hits
   it. 1.6 is 35px, past which the lattice stops reading as a texture and
   starts reading as a sparse pattern of separate points; the power reaches
   it at zoom 3.24. Beyond either clamp the floor only pans. */
export const PARALLAX_EXPONENT = 0.4;
export const PARALLAX_MIN = 0.7;
export const PARALLAX_MAX = 1.6;

export function parallaxScale(zoom: number): number {
  return Math.min(PARALLAX_MAX, Math.max(PARALLAX_MIN, zoom ** PARALLAX_EXPONENT));
}

/* ═══ WHAT COUNTS AS A ZOOM ═══════════════════════════════════════════════
   .
   A relative change of 1e-6 moves a point 1000px from the anchor by a
   thousandth of a pixel, which is float noise from a host's own arithmetic
   (a pan recomputed through `zoom * a / zoom`), not a gesture. Below it the
   change is a pan: no anchor, no wave. */
const ZOOM_EPSILON = 1e-6;

export type SurfaceFieldPoint = { x: number; y: number };

/**
 * The one screen point the camera change left where it was, or `null` for a
 * pure pan. Solves `p = (p - x0) / z0 * z1 + x1` per axis: wheel and pinch
 * zooms in React Flow keep the pointer fixed, so this IS the pointer, read
 * from the cameras alone.
 */
export function zoomFixedPoint(prev: SurfaceFieldViewport, next: SurfaceFieldViewport): SurfaceFieldPoint | null {
  const r = next.zoom / prev.zoom;
  if (!(Math.abs(r - 1) > ZOOM_EPSILON)) return null;
  const x = (next.x - r * prev.x) / (1 - r);
  const y = (next.y - r * prev.y) / (1 - r);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/**
 * Where a zoom is ABOUT, in field px: the fixed point when it falls inside
 * the field's box (a wheel, a pinch, a zoom button about the centre), else
 * the last pointer position the field saw, else the centre. A fixed point
 * outside the box is an animated `fitView` or a zoom combined with a pan in
 * one frame; the floor stays exact either way (see `advanceLattice`), this
 * only decides where it scales about and where the wave starts.
 */
export function pickZoomAnchor(
  fixed: SurfaceFieldPoint | null,
  pointer: SurfaceFieldPoint | null,
  width: number,
  height: number,
): SurfaceFieldPoint {
  if (fixed && fixed.x >= 0 && fixed.y >= 0 && fixed.x <= width && fixed.y <= height) return fixed;
  if (pointer) return pointer;
  return { x: width / 2, y: height / 2 };
}

export type SurfaceFieldLattice = {
  /** The floor's own scale, `parallaxScale(zoom)` of the camera it was built for. */
  scale: number;
  /** Screen distance between neighbouring dots, in CSS px: `gap * scale`. */
  step: number;
  /** Screen x and y of the top-left edge of cell (0, 0), each in (-step, 0]. */
  originX: number;
  originY: number;
  /** Floor index of cell (0, 0): what the breath is hashed from, so a dot keeps its breath while the camera moves. */
  firstCol: number;
  firstRow: number;
};

/* Brings the dot whose centre is at `centre`, with floor index `index`, to
   the first drawn cell: its left edge in (-step, 0] and its index. */
const axis = (centre: number, step: number, index: number): [origin: number, first: number] => {
  const edge = centre - step / 2;
  let cells = Math.ceil(edge / step);
  let origin = edge - cells * step;
  /* Rounding can leave the origin a hair outside its half-open range; move
     one whole cell so every caller can rely on the bound. */
  if (origin <= -step) { origin += step; cells -= 1; }
  else if (origin > 0) { origin -= step; cells += 1; }
  const first = index - cells;
  return [origin, first === 0 ? 0 : first];
};

/**
 * The floor for a camera seen with no history: a field that mounts, or a
 * host that hands over its first camera. Dot (0, 0) sits half a step from
 * the world origin's screen point, the centre the unpanned field always
 * used, so the identity viewport gives exactly the historical grid.
 */
export function seedLattice(gap: number, viewport: SurfaceFieldViewport): SurfaceFieldLattice {
  const scale = parallaxScale(viewport.zoom);
  const step = gap * scale;
  const [originX, firstCol] = axis(viewport.x + step / 2, step, 0);
  const [originY, firstRow] = axis(viewport.y + step / 2, step, 0);
  return { scale, step, originX, originY, firstCol, firstRow };
}

/* ═══ THE FLOOR IS CARRIED, NOT RECOMPUTED ════════════════════════════════
   .
   The plain formula, dots at `x + k * gap * s`, scales the floor about the
   world ORIGIN's screen point. After any real use of a canvas that point is
   thousands of px off screen, so a 1% zoom step slides the dots under the
   pointer by 1% of that distance: many cells per frame, which the modulo
   wraps into a shimmer that has nothing to do with the gesture.
   .
   So each camera change is split into what the camera did to screen space,
   `p -> r * p + (x1 - r * x0)` with `r = z1 / z0`, written as a scale by `r`
   about an anchor `a` plus whatever translation `t` is left over (zero when
   `a` is the fixed point). The floor takes the SAME translation and its own
   ratio `q = s1 / s0` about the same anchor:
   .
       floor' = a + (floor - a) * q + t
   .
   A pure pan is `q = 1, t = d`: exact. A zoom about the pointer leaves the
   floor under the pointer where it was and scales the rest gently around
   it, and a camera path that comes back to where it started does not bring
   the floor back with it, which a floor under a moving graph has no reason
   to do. Dots map to dots, so a floor index survives every change. */
export function advanceLattice(
  lattice: SurfaceFieldLattice,
  gap: number,
  prev: SurfaceFieldViewport,
  next: SurfaceFieldViewport,
  anchor: SurfaceFieldPoint,
): SurfaceFieldLattice {
  const r = next.zoom / prev.zoom;
  const scale = parallaxScale(next.zoom);
  const q = scale / lattice.scale;
  const step = gap * scale;
  const tx = next.x - r * prev.x - anchor.x * (1 - r);
  const ty = next.y - r * prev.y - anchor.y * (1 - r);
  const cx = lattice.originX + lattice.step / 2;
  const cy = lattice.originY + lattice.step / 2;
  const [originX, firstCol] = axis(anchor.x + (cx - anchor.x) * q + tx, step, lattice.firstCol);
  const [originY, firstRow] = axis(anchor.y + (cy - anchor.y) * q + ty, step, lattice.firstRow);
  return { scale, step, originX, originY, firstCol, firstRow };
}

export function sameLattice(a: SurfaceFieldLattice, b: SurfaceFieldLattice): boolean {
  return a.step === b.step && a.originX === b.originX && a.originY === b.originY &&
    a.firstCol === b.firstCol && a.firstRow === b.firstRow;
}
