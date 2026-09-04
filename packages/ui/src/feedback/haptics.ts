import type { HapticInput } from "web-haptics";

/**
 * Haptic feedback, deliberately small.
 *
 * Apple's rule for this is utility: feedback earns its place or it trains
 * people to ignore all of it. Each kind here names a moment, not a component:
 *
 *   - `commit`   a deliberate, consequential action went through (publish).
 *   - `detent`   something snapped to a position the user was aiming at.
 *   - `press`    a control acknowledged the finger landing on it.
 *   - `toggle`   a switch or checkbox changed state.
 *   - `success`  an outcome toast of the good kind.
 *   - `error`    an outcome toast of the bad kind.
 *
 * Hovering, opening, typing and scrolling get nothing. Adding a kind should
 * require an argument and a call site in the same change, not a call site alone.
 */
export type Haptic = "commit" | "detent" | "press" | "toggle" | "success" | "error";

/**
 * What each kind asks the transport for. WebHaptics presets where one fits
 * (two taps for success, three for error, a whisper for a press); plain
 * millisecond durations where the original console haptics already had the
 * right number. Short: a UI haptic is a tap, not a buzz.
 */
export const HAPTIC_PATTERNS: Record<Haptic, HapticInput> = {
  commit: 12,
  detent: 6,
  press: "selection",
  toggle: "light",
  success: "success",
  error: "error",
};

/**
 * The plain Vibration API fallback, used until WebHaptics has loaded (or if
 * it never does). Presets collapse to one short pulse each; the shape of a
 * two-tap success is WebHaptics' job.
 */
export const FALLBACK_DURATIONS_MS: Record<Haptic, number> = {
  commit: 12,
  detent: 6,
  press: 8,
  toggle: 15,
  success: 30,
  error: 40,
};

export interface HapticEnvironment {
  /** Whether a haptic transport exists (`navigator.vibrate`, or the iOS switch path). */
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

export type HapticTransport = (kind: Haptic) => void;

/**
 * iOS Safari has no Vibration API, so "supported" cannot mean `navigator.vibrate`
 * alone: WebHaptics reaches the Taptic Engine through a hidden `<input switch>`
 * on any WebKit that renders one. A transport, once installed, is the authority
 * on support; before one is installed, the Vibration API is all there is.
 */
let transport: HapticTransport | null = null;

export function setHapticTransport(next: HapticTransport | null): void {
  transport = next;
}

function vibrationApiAvailable(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

export function readHapticEnvironment(): HapticEnvironment {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { supported: false, coarsePointer: false, reducedMotion: true };
  }
  return {
    supported: transport !== null || vibrationApiAvailable(),
    coarsePointer: window.matchMedia?.("(pointer: coarse)").matches ?? false,
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  };
}

/**
 * Fire a haptic. Call it on the same frame as the visual it accompanies:
 * latency between the two is what breaks the illusion that they are one event.
 */
export function haptic(kind: Haptic, env: HapticEnvironment = readHapticEnvironment()): void {
  if (!shouldVibrate(env)) return;
  try {
    if (transport) {
      transport(kind);
      return;
    }
    navigator.vibrate(FALLBACK_DURATIONS_MS[kind]);
  } catch {
    // Some browsers expose vibrate and then refuse it (no user gesture yet,
    // permissions policy). A refused haptic is never worth an error.
  }
}
