// Pure geometry behind every drag-to-resize panel. Lives in its own .ts module
// so vitest covers it: the hooks that use it are .tsx-adjacent and the suites
// only collect `src/**/*.test.ts`.
//
// Two rules the hand-rolled versions kept getting wrong:
//
//   1. The panel edge follows the *grab point*, not the pointer. The visible
//      handle is 12px wide and straddles the edge, so setting the edge to the
//      raw clientX teleports the panel by up to 6px on the first pointermove.
//   2. A bound resists, it does not stop. A hard `Math.min` reads as the panel
//      freezing under a finger that is still moving; progressive resistance
//      reads as "still listening, but there is nothing more here".

/**
 * Apple's rubber-band constant. Lower resists harder; 0.55 is the value UIKit
 * uses for scroll overscroll and the one the gesture reads as "familiar".
 */
export const RUBBERBAND_CONSTANT = 0.55;

/**
 * How far a bound may actually be exceeded, given how far the pointer went past
 * it. Asymptotic: the return approaches `dimension * constant` and never
 * reaches it, so the panel can be pushed forever without ever escaping.
 */
export function rubberband(
  overshoot: number,
  dimension: number,
  constant: number = RUBBERBAND_CONSTANT,
): number {
  if (overshoot === 0) return 0;
  const magnitude = Math.abs(overshoot);
  const resisted =
    (magnitude * dimension * constant) / (dimension + constant * magnitude);
  return Math.sign(overshoot) * resisted;
}

/**
 * Signed distance from the pointer to the panel edge it is about to move.
 * Capture this once on pointerdown and subtract it from every move, so the edge
 * stays exactly where it was grabbed.
 */
export function grabOffsetFor(edge: number, pointer: number): number {
  return pointer - edge;
}

export interface ResizeWidthInput {
  /** Current pointer position along the resize axis (clientX). */
  pointer: number;
  /** From `grabOffsetFor` at pointerdown. */
  grabOffset: number;
  /** Which edge of the viewport/container the panel is pinned to. */
  anchor: "left" | "right";
  /** Right edge of a right-anchored panel. Ignored when anchor is "left". */
  containerEdge?: number;
  minWidth: number;
  maxWidth: number;
  /**
   * Spotify-style overdrag floor. When set, the panel may be dragged below
   * `minWidth` all the way down to this width (its content fades out), and the
   * lower bound stops resisting: the user is heading for a collapse, and
   * resistance there would fight an intended gesture.
   */
  overdragTo?: number;
}

/**
 * Width the panel should render for the current pointer position. Clamped at
 * the bound the gesture is not trying to cross, rubber-banded at the one it is.
 */
export function resizeWidthFor({
  pointer,
  grabOffset,
  anchor,
  containerEdge,
  minWidth,
  maxWidth,
  overdragTo,
}: ResizeWidthInput): number {
  const edge = pointer - grabOffset;
  const raw = anchor === "left" ? edge : (containerEdge ?? 0) - edge;
  const lowerBound = overdragTo ?? minWidth;

  if (raw > maxWidth) {
    return maxWidth + rubberband(raw - maxWidth, maxWidth);
  }
  if (raw < lowerBound) {
    // An overdrag floor is a real destination, not a wall: clamp, don't resist.
    return overdragTo !== undefined
      ? lowerBound
      : lowerBound - rubberband(lowerBound - raw, lowerBound);
  }
  return raw;
}
