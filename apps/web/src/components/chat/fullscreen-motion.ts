/**
 * The one motion curve for entering/leaving the chat's full-screen layout.
 *
 * Full screen is realized by the *host*, `public/widget.js` resizes the embed
 * iframe, the docs drawer widens its aside, the editor's Preview panel goes to a
 * fixed overlay, while the chat *inside* it re-flows from a 380px column to a
 * centered 56rem reading column. Both halves must share duration and easing or
 * the expand reads as two separate animations, so the hosts hardcode the same
 * `.42s` / easeOutBack pair.
 *
 * easeOutBack (`cubic-bezier(.34,1.42,.64,1)`) overshoots slightly before it
 * settles, the small bounce on expand and contract. `motion-reduce` drops it.
 */
export const WIDEN_TRANSITION =
  "transition-[padding] duration-[420ms] ease-[cubic-bezier(.34,1.42,.64,1)] motion-reduce:transition-none";
