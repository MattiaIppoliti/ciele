// Pure geometry + interaction rules behind <SwipeButton />. Lives in a .ts module so it is
// covered by vitest (`src/**/*.test.ts` only — a .tsx test is never collected).

/** How close to the end counts as "at the end" — the drag never lands exactly on max. */
export const SWIPE_END_TOLERANCE = 10;

/** Keyboard presses needed to travel the full track (ArrowRight advances 1/N each time). */
export const SWIPE_KEY_STEPS = 4;

export interface SwipeState {
  /** Handle offset from the track start, in px. */
  offset: number;
  /** Handle has reached the commit zone at the end of the track. */
  atEnd: boolean;
}

export const SWIPE_START: SwipeState = { offset: 0, atEnd: false };

/** Usable travel for the handle inside the track. Never negative. */
export function maxSwipeFor(
  containerWidth: number,
  buttonWidth: number,
  gap: number,
): number {
  return Math.max(0, containerWidth - buttonWidth - gap * 2);
}

export function clampOffset(offset: number, maxSwipe: number): number {
  if (!(maxSwipe > 0)) return 0;
  return Math.max(0, Math.min(offset, maxSwipe));
}

export function isAtEnd(offset: number, maxSwipe: number): boolean {
  if (!(maxSwipe > 0)) return false;
  return offset >= maxSwipe - SWIPE_END_TOLERANCE;
}

/** Clamp an offset and derive whether it commits. The only way to build a `SwipeState`. */
export function swipeStateFor(offset: number, maxSwipe: number): SwipeState {
  const clamped = clampOffset(offset, maxSwipe);
  return { offset: clamped, atEnd: isAtEnd(clamped, maxSwipe) };
}

/** Progress as a 0–100 integer, for `aria-valuenow`. */
export function swipeProgress(offset: number, maxSwipe: number): number {
  if (!(maxSwipe > 0)) return 0;
  return Math.round((clampOffset(offset, maxSwipe) / maxSwipe) * 100);
}

export interface SwipeKeyResult {
  /** Where the handle ends up. Unchanged when the key does nothing. */
  state: SwipeState;
  /** Run `onSwipeComplete`. Only ever true for a commit key while already at the end. */
  commit: boolean;
  /** The component owns this key: call `preventDefault()`. */
  handled: boolean;
}

/**
 * Keyboard equivalent of the drag: arrows/End walk the handle along the track, and
 * Enter/Space commit **only** once it is at the end — so confirming still takes a
 * deliberate sequence rather than a single keypress.
 */
export function swipeStateForKey(
  key: string,
  current: SwipeState,
  maxSwipe: number,
  steps: number = SWIPE_KEY_STEPS,
): SwipeKeyResult {
  const step = steps > 0 ? maxSwipe / steps : maxSwipe;
  const move = (offset: number): SwipeKeyResult => ({
    state: swipeStateFor(offset, maxSwipe),
    commit: false,
    handled: true,
  });

  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return move(current.offset + step);
    case "ArrowLeft":
    case "ArrowDown":
      return move(current.offset - step);
    case "End":
      return move(maxSwipe);
    case "Home":
    case "Escape":
      return move(0);
    case "Enter":
    case " ":
    case "Spacebar":
      return {
        state: current,
        commit: current.atEnd && maxSwipe > 0,
        handled: true,
      };
    default:
      return { state: current, commit: false, handled: false };
  }
}
