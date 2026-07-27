/**
 * Geometry for the radial gauge: concentric rings drawn as dashed circles.
 *
 * A ring is one `<circle>` whose stroke is dashed to exactly its own
 * circumference and then offset by the unfilled part — the cheapest way to draw
 * an arc with no path maths and no charting dependency. The numbers live here
 * rather than in the component so the awkward cases (a cap exceeded, a cap of
 * zero producing a non-finite fraction, more rings than fit) are unit tests
 * instead of an SVG that silently renders nothing.
 */

export interface GaugeRing {
  /** Distance from the centre to the middle of the stroke. */
  radius: number;
  strokeWidth: number;
  /** Centre of the box, for cx/cy. */
  center: number;
}

export interface GaugeDash {
  circumference: number;
  /** How much of the ring to leave undrawn. */
  dashOffset: number;
}

/**
 * Dash values for one ring at `fraction` full. The fraction is clamped to
 * `[0, 1]`: usage can exceed a cap, and a full ring is the honest picture —
 * winding round a second time would read as almost empty. A non-finite
 * fraction (`0/0` upstream) draws empty rather than NaN, which SVG ignores
 * entirely.
 */
export function ringDash(fraction: number, radius: number): GaugeDash {
  const circumference = 2 * Math.PI * radius;
  const safe = Number.isNaN(fraction)
    ? 0
    : Math.min(Math.max(fraction, 0), 1);
  return { circumference, dashOffset: circumference * (1 - safe) };
}

/**
 * Radii for `count` concentric rings inside a `size`-square box, outermost
 * first. Rings shrink by stroke + gap; if that would run past the centre the
 * spacing tightens instead of producing a negative radius.
 */
export function gaugeRingGeometry(
  count: number,
  options: { size: number; strokeWidth: number; gap: number }
): GaugeRing[] {
  const { size, strokeWidth, gap } = options;
  const center = size / 2;
  const outer = center - strokeWidth / 2;
  const step = strokeWidth + gap;
  // Keep the innermost ring strictly positive: at worst the rings crowd
  // together, but every radius stays drawable.
  const maxStep = count > 1 ? (outer * 0.9) / (count - 1) : step;
  const spacing = Math.min(step, maxStep);
  return Array.from({ length: count }, (_, index) => ({
    radius: outer - index * spacing,
    strokeWidth,
    center,
  }));
}
