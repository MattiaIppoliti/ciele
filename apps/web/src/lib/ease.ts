export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

/** CSS string form of EASE_OUT for inline style transitions. */
export const EASE_OUT_CSS = "cubic-bezier(0.16, 1, 0.3, 1)";

/**
 * easeOutBack: overshoots ~8% before settling. The curve a surface takes when
 * it grows into place, shared by the Preview's full-screen grow, the embed
 * host's own launcher (`public/widget.js`) and the Flow Canvas's bar. It is a
 * bezier rather than a spring because two of those three run through the Web
 * Animations API, where a spring has to be sampled.
 */
export const EASE_GROW = [0.34, 1.42, 0.64, 1] as const;
export const EASE_GROW_CSS = "cubic-bezier(.34,1.42,.64,1)";
/** How long that growth takes, everywhere it happens. */
export const GROW_DURATION_MS = 420;

/** Press feedback on buttons and other tappable surfaces. */
export const SPRING_PRESS = {
  type: "spring",
  stiffness: 500,
  damping: 30,
  mass: 0.6,
} as const;

/** Content swaps, label/icon slots trading places inside a control. */
export const SPRING_SWAP = {
  type: "spring",
  stiffness: 460,
  damping: 30,
  mass: 0.55,
} as const;

/**
 * Overlay panel entrances, modals and sheets summoned by pointer.
 *
 * Damping is 29, not the 40 it carried before: at k=420 and m=0.5 that was a
 * ratio of 1.38, i.e. overdamped, which settles *slower* than critical damping
 * while still never overshooting. 29 puts it at ~1.0, the fastest a spring
 * reaches its target without bouncing.
 */
export const SPRING_PANEL = {
  type: "spring",
  stiffness: 420,
  damping: 29,
  mass: 0.5,
} as const;

/**
 * The one spring allowed to overshoot. Reserve it for motion a gesture
 * actually threw, a flick, a drag release, a swipe commit. Overshoot on
 * something that merely appeared reads as decoration; overshoot on something
 * you just threw reads as physics.
 *
 * Pass the release velocity alongside it (`{ ...SPRING_THROW, velocity }`) or
 * the handoff is lost and the bounce is arbitrary.
 */
export const SPRING_THROW = {
  type: "spring",
  stiffness: 380,
  damping: 26,
  mass: 0.7,
} as const;

/** Shared-layout glides, pills, indicators and panels morphing between positions. */
export const SPRING_LAYOUT = {
  type: "spring",
  stiffness: 360,
  damping: 32,
  mass: 0.6,
} as const;

/**
 * Motion's bounce/duration spring API, for the surfaces authored against it
 * (select, accordion). Three tokens replace ten ad-hoc literals that differed
 * by amounts nobody can perceive, 0.38 vs 0.32 vs 0.28 vs 0.26 inside a single
 * component, which is noise dressed as intent.
 *
 * The split that does carry meaning: opening is the generous move and may
 * overshoot slightly, closing should be quicker and flatter (the decision is
 * made, get out of the way), and small parts move on their own shorter spring.
 */
export const SPRING_UNFOLD = { type: "spring", duration: 0.5, bounce: 0.28 } as const;
export const SPRING_REFOLD = { type: "spring", duration: 0.32, bounce: 0.1 } as const;
export const SPRING_NUDGE = { type: "spring", duration: 0.4, bounce: 0.2 } as const;

/**
 * Unfold with no overshoot at all. For a surface whose neighbours sit directly
 * below it: positive y overshoot drifts rows past their resting point and
 * briefly overlaps the next one.
 */
export const SPRING_UNFOLD_FLAT = {
  type: "spring",
  duration: 0.5,
  bounce: 0,
} as const;

/** Cursor-follow physics for decorative mouse tracking (magnetic, tilt, dock). */
export const SPRING_MOUSE = {
  stiffness: 200,
  damping: 15,
  mass: 0.3,
} as const;

/** Dragged handles and fills (sliders), critically damped `useSpring` config,
 * so the value follows the pointer butterily and never rebounds off an end. */
export const SPRING_GLIDE = {
  stiffness: 700,
  damping: 50,
  mass: 0.5,
} as const;
