/**
 * Interface sounds and haptics for Ciele's own surfaces (console, marketing
 * site, desktop). One seam: the only place `@foleyjs/core` and `web-haptics`
 * are imported, and both only through dynamic imports inside the runtime, so
 * this barrel is safe to evaluate on the server and costs a marketing Visitor
 * nothing until their first gesture.
 *
 * Primitives opt in by attribute (`data-foley-press` / `-release` on buttons,
 * `data-foley-toggle` on switches and checkboxes, `data-foley-click` for a
 * one-shot cue); code plays the rest through `useFeedback().play(...)`.
 * `data-foley-silent` on an ancestor mutes a subtree.
 */
export {
  FALLBACK_DURATIONS_MS,
  HAPTIC_PATTERNS,
  haptic,
  readHapticEnvironment,
  setHapticTransport,
  shouldVibrate,
  type Haptic,
  type HapticEnvironment,
  type HapticTransport,
} from "./haptics";
export { MUTE_STORAGE_KEY, mutedFromStorageEvent, readMuted, writeMuted, type StorageLike } from "./mute";
export {
  FOLEY_SETTINGS,
  INTERACTIONS,
  INTERACTION_NAMES,
  SUCCESS_COALESCE_MS,
  createCoalescer,
  decide,
  isInteraction,
  shouldPlayCue,
  type CueOptions,
  type FeedbackDecision,
  type FeedbackEnvironment,
  type FeedbackPreferences,
  type FoleyTheme,
  type Interaction,
  type InteractionSpec,
} from "./policy";
export { FeedbackProvider, useFeedback, useOpenChangeFeedback } from "./provider";
export {
  CLICK_ATTR,
  PRESS_ATTR,
  RELEASE_ATTR,
  SILENT_ATTR,
  TOGGLE_ATTR,
  TYPE_ATTR,
  attachFeedback,
  nextToggleState,
  playFeedback,
  readToggleState,
  setActiveFeedbackRuntime,
  type AttachOptions,
  type FeedbackRuntime,
} from "./runtime";
