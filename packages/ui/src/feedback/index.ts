/**
 * Interface sounds and haptics for Ciele's own surfaces (console, marketing
 * site, desktop). One seam: the only place `@foleyjs/core`, `@web-kits/audio`
 * and `web-haptics` are imported, each through dynamic imports inside the runtime, so
 * this barrel is safe to evaluate on the server and costs a marketing Visitor
 * nothing until their first gesture.
 *
 * Primitives opt in by attribute (`data-foley-press` / `-release` on buttons,
 * `data-foley-toggle` on switches and checkboxes, `data-foley-click` for a
 * one-shot cue); code plays the rest through `useFeedback().play(...)`.
 * `data-foley-silent` on an ancestor mutes a subtree.
 */
export { haptic } from "./haptics";
export type { Interaction } from "./policy";
export { FeedbackProvider, useFeedback, useOpenChangeFeedback } from "./provider";
export { playFeedback, setActiveFeedbackRuntime, type FeedbackRuntime } from "./runtime";
