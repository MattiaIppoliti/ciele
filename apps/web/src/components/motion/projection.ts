// Momentum projection for gesture releases. Pure, so vitest reaches it (the
// suite collects `src/**/*.test.ts` only, never a .tsx).
//
// The rule this encodes: do not snap to the boundary nearest where the finger
// *stopped*, snap to the one nearest where the gesture was *going*. A flick
// should throw the sheet; a slow drag released at the same point should not.

/**
 * Scroll deceleration rate. 0.998 is the normal "flick a list" feel; 0.99 is
 * noticeably snappier and stops sooner.
 */
export const DECELERATION_RATE = 0.998;

/**
 * How far a gesture would still travel after release, in px.
 *
 * This is the exponential-decay form used by scroll physics, not the
 * v²/(2·a) from a textbook: the two disagree by orders of magnitude and only
 * this one matches how a released list actually settles.
 */
export function projectMomentum(
  velocity: number,
  decelerationRate: number = DECELERATION_RATE,
): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Index of the candidate closest to `value`. Ties go to the earlier one. */
export function nearestIndex(value: number, candidates: number[]): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < candidates.length; i += 1) {
    const distance = Math.abs(candidates[i] - value);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

export type SheetRelease =
  | { kind: "snap"; index: number }
  | { kind: "dismiss" };

export interface SheetReleaseInput {
  /** Fractions of viewport height, ascending. "auto" heights resolve upstream. */
  snapPoints: number[];
  currentIndex: number;
  viewportHeight: number;
  /** Drag offset on release, px. Positive is downward (toward dismissal). */
  offset: number;
  /** Release velocity, px/s. Positive is downward. */
  velocity: number;
  /** Drag distance past which a release dismisses outright. */
  dismissThreshold: number;
}

/**
 * Where a released sheet should land.
 *
 * Everything is decided in one coordinate: the sheet's projected *top* edge as
 * a fraction of the viewport, so a fling and a drag are compared on the same
 * axis instead of against two unrelated thresholds.
 */
export function sheetReleaseFor({
  snapPoints,
  currentIndex,
  viewportHeight,
  offset,
  velocity,
  dismissThreshold,
}: SheetReleaseInput): SheetRelease {
  const height = viewportHeight > 0 ? viewportHeight : 1;
  const projectedOffset = offset + projectMomentum(velocity);

  // Heights the sheet could settle at, as the fraction still on screen once the
  // projected offset is taken off the snap the gesture started from.
  const startHeight = snapPoints[currentIndex] ?? snapPoints[0] ?? 0;
  const projectedHeight = startHeight - projectedOffset / height;

  // Past the smallest snap by a full dismiss threshold's worth of travel, the
  // gesture is heading off the bottom of the screen, not toward a detent.
  const smallest = snapPoints[0] ?? 0;
  if (projectedHeight < smallest - dismissThreshold / height) {
    return { kind: "dismiss" };
  }

  const index = nearestIndex(projectedHeight, snapPoints);
  return { kind: "snap", index };
}
