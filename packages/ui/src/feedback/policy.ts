import type { CueName } from "@foleyjs/core";

import { shouldVibrate, type Haptic } from "./haptics";

/**
 * The interaction vocabulary: every moment Ciele's own interfaces answer with
 * sound, and what they answer with. This is the sound design of the product,
 * fixed in code like the spring tokens; nothing an Organization configures.
 *
 * The published widget never mounts the provider that reads this table, so
 * none of it reaches a Visitor on an institution's site.
 */
export type Interaction =
  | "press"
  | "release"
  | "tap"
  | "on"
  | "off"
  | "switch"
  | "sweep"
  | "copy"
  | "tick"
  | "click"
  | "open"
  | "close"
  | "success"
  | "error"
  | "warning"
  | "arrive"
  | "send"
  | "reply"
  | "complete";

/**
 * How loud and how high one cue is performed, on top of the global settings.
 *
 * `volume` is a multiplier (1 is the theme's own level) and `pitch` is in
 * semitones, which is how Foley reads them. Both exist for one reason: the
 * fallback click has to be audible without being a sound anyone notices, and
 * "quieter and thinner" is the difference between texture and chatter.
 */
export interface CueOptions {
  volume?: number;
  pitch?: number;
}

/** Foley's four sonic identities. `FOLEY_SETTINGS.theme` is the product's own. */
export type FoleyTheme = "default" | "soft" | "mechanical" | "glass";

export interface InteractionSpec {
  cue: CueName;
  haptic: Haptic | null;
  options?: CueOptions;
  /**
   * Perform this one cue in another identity than the product's.
   *
   * Foley applies the theme when it synthesises, not when it resolves the cue,
   * so the runtime switches the global identity around the call and puts it
   * back. That is sound because a cue's voices are scheduled synchronously
   * inside `play`, and none of these cues loops.
   */
  theme?: FoleyTheme;
}

export const INTERACTIONS: Record<Interaction, InteractionSpec> = {
  // Pointer landing on and leaving a control; `tap` is the keyboard's click.
  press: { cue: "press", haptic: "press" },
  release: { cue: "release", haptic: null },
  tap: { cue: "tap", haptic: "press" },
  // Switches, checkboxes, toggles: the new state, not the gesture.
  on: { cue: "on", haptic: "toggle" },
  off: { cue: "off", haptic: "toggle" },
  // Picking one of several options (the account menu's Theme), where there is
  // no on and no off: the same family, the throw rather than the state.
  switch: { cue: "switch", haptic: "toggle" },
  // A toggle whose whole surface travels rather than clicking: the marketing
  // site's day-to-night theme control, where the sky itself moves. Motion
  // family, so it reads as air rather than a mechanism, and it is the same
  // sound in both directions, because the movement is what is heard.
  sweep: { cue: "swoosh", haptic: "toggle", options: { volume: 0.6 } },
  // A copy that landed. Its own cue rather than `success`: something left the
  // page for the clipboard, which is a smaller claim than an action going
  // through, and it is the one outcome people fire a dozen times in a row.
  copy: { cue: "glide", haptic: "press" },
  // Tabs, and the sidebar snapping to its rail.
  tick: { cue: "tick", haptic: null },
  // The floor: anything clickable that no other interaction claimed, which
  // includes navigation, the sidebar rows and the assistant cards. The same
  // tick, quieter and five semitones up, so a click nothing was written for is
  // felt rather than heard. Louder than this and every stray control in the
  // product starts competing with the ones that mean something.
  click: { cue: "tick", haptic: null, options: { volume: 0.5, pitch: 5 } },
  // Layers: dialogs, popovers, dropdowns, the Find palette, the Developer
  // Panel. Motion cues swell rather than click, so they peak well above the
  // rest of the set at the same nominal level and are held back here.
  open: { cue: "rise", haptic: null, options: { volume: 0.55 } },
  close: { cue: "drop", haptic: null, options: { volume: 0.55 } },
  // Outcome toasts.
  success: { cue: "success", haptic: "success" },
  error: { cue: "error", haptic: "error" },
  warning: { cue: "warning", haptic: null },
  // A new Alert or mention while the page is already open.
  arrive: { cue: "chime", haptic: null, options: { volume: 0.6 } },
  // Chat, everywhere it happens: the published widget, the Assistant Preview,
  // Teammate chat and channels. These two are **mechanical** on purpose, the
  // only cues in the product that leave the soft identity: sending a message
  // and getting an answer are the one exchange where a key travelling and a
  // switch closing say more than air moving.
  send: { cue: "tick", haptic: "press", theme: "mechanical" },
  reply: { cue: "on", haptic: "toggle", theme: "mechanical", options: { volume: 0.8 } },
  complete: { cue: "tick", haptic: null },
};

export const INTERACTION_NAMES = Object.keys(INTERACTIONS) as Interaction[];

/** Foley's global settings for every Ciele surface. One place, one constant each. */
export const FOLEY_SETTINGS = {
  theme: "soft",
  // The whole product's ceiling. Low on purpose: these cues answer clicks all
  // day in an office, and the loudest one anybody hears should still sit under
  // the room. Every cue that peaks above the click family is held back further
  // in the table above.
  volume: 0.22,
  space: 0,
  hover: false,
} as const;

/** Two `success` cues closer than this are one event (bulk resolve, fast tabbing). */
export const SUCCESS_COALESCE_MS = 250;

export interface FeedbackEnvironment {
  /** A user gesture has happened in this document, so audio may start. */
  audioAllowed: boolean;
  /** A haptic transport exists (Vibration API, or WebHaptics' iOS switch). */
  hapticSupported: boolean;
  /** Touch device: the only place a haptic reaches a hand. */
  coarsePointer: boolean;
  /** `prefers-reduced-motion`: haptics are motion you feel. Sound is not motion. */
  reducedMotion: boolean;
  /** Background tab: nothing should sound from a page nobody is looking at. */
  documentHidden: boolean;
}

export interface FeedbackPreferences {
  /** The one user control: Mute in the user menu. Sound only; haptics follow the OS. */
  muted: boolean;
}

export interface FeedbackDecision {
  cue: CueName | null;
  /** How to perform that cue, when the interaction shapes it. */
  options: CueOptions | undefined;
  /** The identity to perform it in, when it is not the product's own. */
  theme: FoleyTheme | undefined;
  /** The haptic kind to fire; `haptic()` owns the pattern behind it. */
  haptic: Haptic | null;
}

/** Whether a string from the DOM names an interaction, before it reaches the table. */
export function isInteraction(value: string | null): value is Interaction {
  return value !== null && Object.prototype.hasOwnProperty.call(INTERACTIONS, value);
}

/** Whether a cue may sound at all, before asking which one. */
export function shouldPlayCue(env: FeedbackEnvironment, prefs: FeedbackPreferences): boolean {
  if (prefs.muted) return false;
  if (!env.audioAllowed) return false;
  if (env.documentHidden) return false;
  return true;
}

/**
 * The whole fire/no-fire decision, pure so it is testable without a device.
 * The two failure modes it guards against, silent on a phone and buzzing on a
 * desk, are invisible in a screenshot and only ever found by ear.
 */
export function decide(
  interaction: Interaction,
  env: FeedbackEnvironment,
  prefs: FeedbackPreferences,
): FeedbackDecision {
  const spec = INTERACTIONS[interaction];
  const cue = shouldPlayCue(env, prefs) ? spec.cue : null;
  const wantsHaptic =
    spec.haptic !== null &&
    shouldVibrate({
      supported: env.hapticSupported,
      coarsePointer: env.coarsePointer,
      reducedMotion: env.reducedMotion,
    });
  return {
    cue,
    options: spec.options,
    theme: spec.theme,
    haptic: wantsHaptic ? spec.haptic : null,
  };
}

/**
 * Collapses a burst of the same key into one event. Injected clock so the
 * window is asserted, not timed.
 */
export function createCoalescer(windowMs: number, now: () => number = () => Date.now()) {
  const last = new Map<string, number>();
  return {
    allow(key: string): boolean {
      const t = now();
      const previous = last.get(key);
      if (previous !== undefined && t - previous < windowMs) return false;
      last.set(key, t);
      return true;
    },
  };
}
