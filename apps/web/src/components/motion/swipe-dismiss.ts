/**
 * Release thresholds for the phone-style "swipe the card away" gesture. Kept in
 * plain TS so the decision is unit-tested; the component only supplies the
 * pointer numbers.
 */

/** Travel (px) that dismisses on its own, however slowly you got there. */
export const SWIPE_DISMISS_DISTANCE = 96;
/** Flick speed (px/s) that dismisses from a short drag. */
export const SWIPE_DISMISS_VELOCITY = 480;
/** A flick still needs this much travel, so a jittery tap never dismisses. */
export const SWIPE_DISMISS_MIN_DISTANCE = 24;

export type SwipeRelease = {
  /** Horizontal distance from where the drag started; rightward is positive. */
  offset: number;
  /** Horizontal pointer velocity at release, px/s. */
  velocity: number;
};

/**
 * True when a release should dismiss the card. Only rightward swipes count,
 * leftward travel is elastic slack that springs back.
 */
export function shouldDismissSwipe({ offset, velocity }: SwipeRelease): boolean {
  if (offset <= 0) return false;
  if (offset >= SWIPE_DISMISS_DISTANCE) return true;
  return (
    offset >= SWIPE_DISMISS_MIN_DISTANCE && velocity >= SWIPE_DISMISS_VELOCITY
  );
}
