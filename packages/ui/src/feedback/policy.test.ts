import { describe, expect, it } from "vitest";

import { HAPTIC_PATTERNS } from "./haptics";
import {
  FOLEY_SETTINGS,
  INTERACTIONS,
  INTERACTION_NAMES,
  SUCCESS_COALESCE_MS,
  createCoalescer,
  decide,
  isInteraction,
  shouldPlayCue,
  type FeedbackEnvironment,
} from "./policy";

/** Foley's 28 cues, by family, as its declaration file lists them. */
const FOLEY_CUES = new Set([
  "tick", "hover", "glide", "pop",
  "press", "release", "tap", "thock",
  "on", "off", "switch", "latch",
  "success", "error", "warning", "denied",
  "chime", "ping", "bell", "bubble",
  "swoosh", "whoosh", "drop", "rise",
  "loading", "ready", "complete", "sparkle",
]);

/** WebHaptics' built-in presets, from its `defaultPatterns`. */
const WEB_HAPTICS_PRESETS = new Set([
  "success", "warning", "error", "light", "medium", "heavy", "soft", "rigid", "selection", "nudge", "buzz",
]);

const phone: FeedbackEnvironment = {
  audioAllowed: true,
  hapticSupported: true,
  coarsePointer: true,
  reducedMotion: false,
  documentHidden: false,
};

const desk: FeedbackEnvironment = {
  ...phone,
  hapticSupported: true, // desktop Chrome exposes vibrate and does nothing with it
  coarsePointer: false,
};

const loud = { muted: false };
const quiet = { muted: true };

describe("the interaction table", () => {
  it("names only cues Foley can perform", () => {
    for (const name of INTERACTION_NAMES) {
      expect(FOLEY_CUES.has(INTERACTIONS[name].cue), `${name} → ${INTERACTIONS[name].cue}`).toBe(true);
    }
  });

  it("maps every haptic kind to a WebHaptics preset or a short duration", () => {
    for (const [kind, pattern] of Object.entries(HAPTIC_PATTERNS)) {
      if (typeof pattern === "number") {
        expect(pattern, kind).toBeGreaterThan(0);
        expect(pattern, `${kind} is a tap, not a buzz`).toBeLessThanOrEqual(50);
      } else {
        expect(WEB_HAPTICS_PRESETS.has(pattern as string), `${kind} → ${String(pattern)}`).toBe(true);
      }
    }
  });

  it("never sounds on hover, by configuration rather than discipline", () => {
    expect(FOLEY_SETTINGS.hover).toBe(false);
    expect(INTERACTION_NAMES).not.toContain("hover");
  });

  it("starts quiet on a new device", () => {
    expect(FOLEY_SETTINGS.volume).toBeLessThanOrEqual(0.25);
    expect(FOLEY_SETTINGS.theme).toBe("soft");
  });

  it("holds the swelling cues under the clicking ones", () => {
    // Motion and Notify cues swell instead of clicking, so at the same
    // nominal level they peak far above the rest and are the first thing
    // anyone calls too loud.
    for (const name of ["open", "close", "sweep", "arrive"] as const) {
      expect(INTERACTIONS[name].options?.volume, name).toBeLessThanOrEqual(0.6);
    }
  });

  it("keeps the fallback click well under the cues that mean something", () => {
    // The floor under every unmapped control fires far more often than any
    // other cue, so its level is the whole reason it is bearable.
    const fallback = INTERACTIONS.click;
    expect(fallback.cue).toBe("tick");
    expect(fallback.haptic).toBeNull();
    expect(fallback.options?.volume).toBeLessThanOrEqual(0.5);
    expect(fallback.options?.pitch).toBeGreaterThan(0);
    // Quieter than the deliberate tick it borrows, which carries no options
    // and therefore performs at full level.
    expect(INTERACTIONS.tick.options).toBeUndefined();
  });

  it("leaves the whole product in one identity, apart from the chat exchange", () => {
    // A second identity is a second product to a listener, so the exception
    // has to be short and it has to be argued. Sending a message and getting
    // an answer are mechanical; nothing else is.
    const elsewhere = INTERACTION_NAMES.filter((name) => INTERACTIONS[name].theme);
    expect(elsewhere).toEqual(["send", "reply"]);
    expect(INTERACTIONS.send.cue).toBe("tick");
    expect(INTERACTIONS.reply.cue).toBe("on");
  });

  it("leaves the click family at the level the theme set", () => {
    // press, release, tap, on, off and the outcomes are the reference: shaping
    // them here would be doing the global volume's job twice.
    for (const name of ["press", "release", "tap", "on", "off", "success", "error"] as const) {
      expect(INTERACTIONS[name].options, name).toBeUndefined();
    }
  });
});

describe("decide", () => {
  it("plays cue and haptic for a press on a phone", () => {
    expect(decide("press", phone, loud)).toEqual({
      cue: "press",
      options: undefined,
      theme: undefined,
      haptic: "press",
    });
  });

  it("carries the interaction's performance options with the cue", () => {
    expect(decide("click", phone, loud)).toEqual({
      cue: "tick",
      options: INTERACTIONS.click.options,
      theme: undefined,
      haptic: null,
    });
  });

  it("carries the identity a cue asks to be performed in", () => {
    expect(decide("send", phone, loud).theme).toBe("mechanical");
    expect(decide("press", phone, loud).theme).toBeUndefined();
  });

  it("plays the cue but never a haptic on a desk", () => {
    expect(decide("press", desk, loud)).toEqual({ cue: "press", haptic: null });
    expect(decide("success", desk, loud).haptic).toBeNull();
  });

  it("is silent before the first gesture, haptics included in the sense that nothing was asked", () => {
    const untouched = { ...phone, audioAllowed: false };
    expect(decide("press", untouched, loud).cue).toBeNull();
  });

  it("is silent in a hidden tab but still vibrates a phone in a pocket-free hand", () => {
    // The tab is hidden, so no sound; a haptic on a hidden tab cannot happen
    // without a gesture on it anyway, so the policy leaves it alone.
    const hidden = { ...phone, documentHidden: true };
    expect(decide("arrive", hidden, loud).cue).toBeNull();
  });

  it("mute silences sound and leaves haptics alone", () => {
    const d = decide("on", phone, quiet);
    expect(d.cue).toBeNull();
    expect(d.haptic).toBe("toggle");
  });

  it("reduced motion disables haptics and leaves sound alone", () => {
    const d = decide("on", { ...phone, reducedMotion: true }, loud);
    expect(d.cue).toBe("on");
    expect(d.haptic).toBeNull();
  });

  it("a null haptic in the table stays null however capable the device", () => {
    expect(INTERACTIONS.release.haptic).toBeNull();
    expect(decide("release", phone, loud).haptic).toBeNull();
    expect(decide("tick", phone, loud).haptic).toBeNull();
  });

  it("needs a transport for a haptic even on a coarse pointer", () => {
    expect(decide("press", { ...phone, hapticSupported: false }, loud).haptic).toBeNull();
  });
});

describe("isInteraction", () => {
  it("accepts the vocabulary and refuses anything else from the DOM", () => {
    expect(isInteraction("tick")).toBe(true);
    expect(isInteraction("switch")).toBe(true);
    expect(isInteraction("copy")).toBe(true);
    expect(isInteraction("sweep")).toBe(true);
    expect(isInteraction("click")).toBe(true);
    expect(isInteraction("sparkle")).toBe(false);
    expect(isInteraction("toString")).toBe(false);
    expect(isInteraction("")).toBe(false);
    expect(isInteraction(null)).toBe(false);
  });
});

describe("shouldPlayCue", () => {
  it("needs every condition", () => {
    expect(shouldPlayCue(phone, loud)).toBe(true);
    expect(shouldPlayCue(phone, quiet)).toBe(false);
    expect(shouldPlayCue({ ...phone, audioAllowed: false }, loud)).toBe(false);
    expect(shouldPlayCue({ ...phone, documentHidden: true }, loud)).toBe(false);
  });
});

describe("createCoalescer", () => {
  it("lets one success through per window and the next after it", () => {
    let t = 1000;
    const c = createCoalescer(SUCCESS_COALESCE_MS, () => t);
    expect(c.allow("success")).toBe(true);
    t += 100;
    expect(c.allow("success")).toBe(false);
    t += SUCCESS_COALESCE_MS;
    expect(c.allow("success")).toBe(true);
  });

  it("keys are independent", () => {
    const c = createCoalescer(250, () => 0);
    expect(c.allow("a")).toBe(true);
    expect(c.allow("b")).toBe(true);
  });
});
