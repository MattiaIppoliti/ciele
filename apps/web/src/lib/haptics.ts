/**
 * Haptic feedback, deliberately tiny.
 *
 * Apple's rule for this is utility: feedback earns its place or it trains
 * people to ignore all of it. So there are exactly three moments, and adding a
 * fourth should require an argument, not a call site:
 *
 *   - `commit`   a deliberate, consequential action went through (publish).
 *   - `detent`   something snapped to a position the user was aiming at.
 *
 * Everything else (hovering, opening, typing, scrolling) gets nothing. A third
 * pattern for refusals was written and then removed: it had no call site, and a
 * haptic vocabulary nothing speaks is the start of the over-feedback this file
 * exists to avoid. Add it back with the call site, not before.
 */
export type Haptic = "commit" | "detent";

/** Durations in ms. Short: a UI haptic is a tap, not a buzz. */
const PATTERNS: Record<Haptic, number> = {
  commit: 12,
  detent: 6,
};

export interface HapticEnvironment {
  /** Whether `navigator.vibrate` exists. */
  supported: boolean;
  /** True when the pointer is coarse, i.e. a touch device that can vibrate. */
  coarsePointer: boolean;
  /** The user asked for less motion; haptics are motion they can feel. */
  reducedMotion: boolean;
}

/**
 * Whether to fire, given the environment. Pure so the policy is testable
 * without a device: the wrong answer here is silent on a phone or buzzing on a
 * desktop, and neither shows up in a screenshot.
 */
export function shouldVibrate(env: HapticEnvironment): boolean {
  if (!env.supported) return false;
  if (!env.coarsePointer) return false;
  if (env.reducedMotion) return false;
  return true;
}

function readEnvironment(): HapticEnvironment {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { supported: false, coarsePointer: false, reducedMotion: true };
  }
  return {
    supported: typeof navigator.vibrate === "function",
    coarsePointer: window.matchMedia?.("(pointer: coarse)").matches ?? false,
    reducedMotion:
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  };
}

/**
 * Fire a haptic. Call it on the same frame as the visual it accompanies:
 * latency between the two is what breaks the illusion that they are one event.
 */
export function haptic(kind: Haptic, env: HapticEnvironment = readEnvironment()) {
  if (!shouldVibrate(env)) return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    // Some browsers expose vibrate and then refuse it (no user gesture yet,
    // permissions policy). A refused haptic is never worth an error.
  }
}
