import type { CueName } from "@foleyjs/core";
import type { AudioPatch } from "@web-kits/audio";
import type { BenchoPlayer } from "./sounds/bencho";

import { HAPTIC_PATTERNS, haptic, setHapticTransport } from "./haptics";
import { minimal } from "./sounds";
import {
  FOLEY_SETTINGS,
  SUCCESS_COALESCE_MS,
  createCoalescer,
  decide,
  isInteraction,
  type CueOptions,
  type FeedbackEnvironment,
  type FoleyTheme,
  type Interaction,
} from "./policy";

/**
 * The browser half of the feedback module: one delegated listener set on the
 * document, the lazy loading of the sound engines and haptics, and the bridge
 * from an interaction to Bencho or Minimal/Foley playback and WebHaptics' `trigger()`.
 *
 * Why not Foley's own `bind()`: it decides a toggle's state from `aria-pressed`
 * only (Base UI switches and checkboxes speak `aria-checked`), it has no way to
 * silence a subtree (the marketing site's drawn console mock must not answer a
 * press), and it does not know about mute, hidden tabs or haptics. So the
 * attribute names are Foley's, the binder is ours, and `bind()` is never
 * called: calling it too would double every cue.
 *
 * The selected sound engine and WebHaptics are imported inside the first
 * user gesture. A page nobody touches downloads none, and a server bundle can
 * never evaluate a module that reaches for `AudioContext`.
 */

export const PRESS_ATTR = "data-foley-press";
export const RELEASE_ATTR = "data-foley-release";
export const CLICK_ATTR = "data-foley-click";
export const TOGGLE_ATTR = "data-foley-toggle";
/** A text field whose Enter is a completion (the Find palette): Enter plays `complete`, keys stay silent. */
export const TYPE_ATTR = "data-foley-type";
/** Any ancestor carrying this silences the subtree: decorative mocks, demos. */
export const SILENT_ATTR = "data-foley-silent";

/**
 * What counts as clickable for the fallback tick.
 *
 * A click on nothing must stay silent, so this is a list of things that
 * *activate* rather than "any click in the document". Text fields are absent
 * on purpose: clicking into one is focusing it, which belongs to typing, and
 * typing is silent everywhere except the Find palette's Enter.
 */
const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "summary",
  "select",
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="file"]',
  'input[type="color"]',
  'input[type="range"]',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="treeitem"]',
].join(",");

type FoleyModule = typeof import("@foleyjs/core");

/** The Minimal patch covers the shared platform UI; chat keeps its Foley identity. */
const MINIMAL_CUES: Partial<Record<Interaction, string>> = {
  press: "key-press",
  tap: "tap",
  on: "toggle-on",
  off: "toggle-off",
  switch: "select",
  sweep: "swoosh",
  copy: "copy",
  tick: "tab-switch",
  click: "click",
  open: "expand",
  close: "collapse",
  success: "success",
  error: "error",
  warning: "warning",
  arrive: "notification",
  complete: "key-press",
};

function performMinimalCue(
  patch: AudioPatch,
  cue: string,
  options: CueOptions | undefined,
): void {
  patch.play(cue, {
    // The patch's definitions already carry their quiet gain levels.
    volume: options?.volume ?? 1,
    ...(options?.pitch === undefined ? {} : { detune: options.pitch * 100 }),
  });
}

export interface FeedbackRuntime {
  /** Play an interaction from code (toasts, stream lifecycle, snaps). */
  play(interaction: Interaction): void;
  destroy(): void;
}

export interface AttachOptions {
  isMuted: () => boolean;
  /** The admin uses Bencho; other surfaces keep their established sound set. */
  soundSet?: "bencho";
}

/** One cue to play, or the latest one waiting while the audio modules unlock. */
interface CueRequest {
  interaction: Interaction;
  cue: CueName;
  options: CueOptions | undefined;
  theme: FoleyTheme | undefined;
}

/**
 * Play one cue, in another identity than the product's when it asks for one.
 *
 * Foley keeps the theme as module state read at synthesis time, and there is
 * no per-play theme option, so the only way to have two mechanical cues in an
 * otherwise soft product is to switch the identity around the call. The swap
 * is safe because `play` schedules the cue's voices before it returns.
 */
function performCue(
  foley: Pick<FoleyModule, "play" | "set">,
  cue: CueName,
  options: CueOptions | undefined,
  theme: FoleyTheme | undefined,
): void {
  if (!theme) {
    foley.play(cue, options);
    return;
  }
  foley.set({ theme });
  try {
    foley.play(cue, options);
  } finally {
    foley.set({ theme: FOLEY_SETTINGS.theme });
  }
}

function closest(target: EventTarget | null, selector: string): Element | null {
  return target instanceof Element ? target.closest(selector) : null;
}

function silenced(el: Element): boolean {
  return el.closest(`[${SILENT_ATTR}]`) !== null;
}

function disabled(el: Element): boolean {
  return (
    el.getAttribute("aria-disabled") === "true" ||
    (el as HTMLButtonElement).disabled === true ||
    el.hasAttribute("data-disabled")
  );
}

function isNativeToggle(el: Element): el is HTMLInputElement {
  return el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio");
}

/** A toggle's current state, whichever attribute the primitive speaks. */
export function readToggleState(el: Element): boolean | null {
  const checked = el.getAttribute("aria-checked");
  if (checked === "true" || checked === "false") return checked === "true";
  const pressed = el.getAttribute("aria-pressed");
  if (pressed === "true" || pressed === "false") return pressed === "true";
  // Disclosures (the Thinking panel, the Sources fold) are toggles too.
  const expanded = el.getAttribute("aria-expanded");
  if (expanded === "true" || expanded === "false") return expanded === "true";
  if (isNativeToggle(el)) return el.checked;
  return null;
}

/**
 * The state a toggle is about to have. React flushes a discrete event's state
 * before the event reaches the document, but a controlled primitive whose
 * parent refuses the change does not move at all, so the bubble-phase reading
 * is compared with the capture-phase one rather than trusted or inverted blindly.
 */
export function nextToggleState(before: boolean | null, after: boolean | null): boolean | null {
  if (before === null && after === null) return null;
  if (before !== null && after !== null && before !== after) return after;
  if (before !== null) return !before;
  return after;
}

/**
 * The mounted provider's runtime, for callers with no React tree to hand:
 * the toast façade, a stream lifecycle, a drag's release. One per document,
 * and `null` wherever no provider is mounted (the widget), which is what makes
 * the toast wrapper silent there without a flag.
 */
let activeRuntime: FeedbackRuntime | null = null;

export function setActiveFeedbackRuntime(runtime: FeedbackRuntime | null): void {
  activeRuntime = runtime;
}

/** Play through the mounted provider, or do nothing where there is none. */
export function playFeedback(interaction: Interaction): void {
  activeRuntime?.play(interaction);
}

export function attachFeedback(doc: Document, options: AttachOptions): FeedbackRuntime {
  const win = doc.defaultView;
  let foley: Pick<FoleyModule, "play" | "set"> | null = null;
  let minimalPatch: AudioPatch | null = null;
  let bencho: BenchoPlayer | null = null;
  let benchoSettled = false;
  let foleySettled = false;
  let minimalSettled = false;
  let unlocked = false;
  let destroyed = false;
  let pendingCue: CueRequest | null = null;
  let hapticsReady = false;
  const successCoalescer = createCoalescer(SUCCESS_COALESCE_MS);

  function environment(): FeedbackEnvironment {
    return {
      audioAllowed: unlocked,
      hapticSupported:
        (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") ||
        hapticsReady,
      coarsePointer: win?.matchMedia?.("(pointer: coarse)").matches ?? false,
      reducedMotion: win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
      documentHidden: doc.hidden,
    };
  }

  function play(interaction: Interaction): void {
    if (destroyed) return;
    // A burst of successes (bulk resolve) is one event, cue and haptic alike.
    if (interaction === "success" && !successCoalescer.allow()) return;
    // A copy that also toasts ("Assistant ID copied") is still one event, and
    // `glide` is the one the button asked for, so it claims the slot the
    // toast's `success` would have taken.
    if (interaction === "copy") successCoalescer.allow();
    const decision = decide(interaction, environment(), { muted: options.isMuted() });
    if (decision.cue) {
      const request: CueRequest = {
        interaction,
        cue: decision.cue,
        options: decision.options,
        theme: decision.theme,
      };
      // Keep only the latest interaction while audio modules are unlocking.
      if (!perform(request)) pendingCue = request;
    }
    if (decision.haptic) haptic(decision.haptic);
  }

  /** Play on the engine that owns the cue; false while that engine is still loading. */
  function perform(request: CueRequest): boolean {
    if (options.soundSet === "bencho") {
      if (!bencho) return false;
      bencho.play(request.interaction, request.options);
      return true;
    }
    const minimalCue = MINIMAL_CUES[request.interaction];
    if (minimalCue && minimalPatch) {
      performMinimalCue(minimalPatch, minimalCue, request.options);
      return true;
    }
    // If the patch could not load, retain the established Foley fallback.
    if ((!minimalCue || minimalSettled) && foley) {
      performCue(foley, request.cue, request.options, request.theme);
      return true;
    }
    return false;
  }

  function flushPendingCue(): void {
    if (!pendingCue || options.isMuted() || doc.hidden) {
      pendingCue = null;
      return;
    }
    const queued = pendingCue;
    // Played, or its engine has settled without loading: either way it is done.
    const settled = options.soundSet === "bencho"
      ? benchoSettled
      : ((!MINIMAL_CUES[queued.interaction] || minimalSettled) && foleySettled);
    if (perform(queued) || settled) {
      pendingCue = null;
    }
  }

  function unlock(): void {
    if (unlocked || destroyed) return;
    unlocked = true;
    if (options.soundSet === "bencho") {
      void import("./sounds/bencho")
        .then((mod) => {
          if (destroyed) return;
          bencho = mod.createBenchoPlayer(() => !destroyed && !options.isMuted() && !doc.hidden);
          benchoSettled = true;
          flushPendingCue();
        })
        .catch(() => {
          // Unsupported audio stays silent rather than switching back to the old identity.
          benchoSettled = true;
          flushPendingCue();
        });
    } else {
      void import("@foleyjs/core")
        .then((mod) => {
          if (destroyed) return;
          foley = mod;
          mod.set({ ...FOLEY_SETTINGS });
          foleySettled = true;
          flushPendingCue();
        })
        .catch(() => {
          // No audio is a degraded state, not an error worth a console line.
          foleySettled = true;
          flushPendingCue();
        });
      void import("@web-kits/audio")
        .then((mod) => {
          if (destroyed) return;
          minimalPatch = mod.createPatchInstance(minimal._patch);
          minimalSettled = true;
          flushPendingCue();
        })
        .catch(() => {
          minimalSettled = true;
          flushPendingCue();
        });
    }
    void import("web-haptics")
      .then((mod) => {
        // `showSwitch: false` keeps the iOS `<input switch>` WebHaptics clicks
        // for the Taptic Engine out of sight; it is still there and still works.
        const instance = new mod.WebHaptics({ showSwitch: false });
        if (destroyed) return;
        hapticsReady = true;
        setHapticTransport((kind) => {
          void instance.trigger(HAPTIC_PATTERNS[kind]);
        });
      })
      .catch(() => {
        // The Vibration API fallback in `haptic()` still runs where it exists.
      });
  }

  // A toggle's state before React sees the click (capture) and after (bubble).
  let toggleBefore: boolean | null = null;

  const onCaptureClick = (e: Event) => {
    const el = closest(e.target, `[${TOGGLE_ATTR}]`);
    toggleBefore = el ? readToggleState(el) : null;
  };

  const onPointerDown = (e: Event) => {
    unlock();
    // Secondary-button presses open a context menu; they are not button presses.
    // The menu itself emits the shared `open` cue when it actually appears.
    const pointer = e as PointerEvent;
    if (pointer.pointerType === "mouse" && pointer.button !== 0) return;
    const el = closest(e.target, `[${PRESS_ATTR}]`);
    if (!el || silenced(el) || disabled(el)) return;
    play("press");
  };

  const onPointerUp = (e: Event) => {
    const el = closest(e.target, `[${RELEASE_ATTR}]`);
    if (!el || silenced(el) || disabled(el)) return;
    play("release");
  };

  const onClick = (e: Event) => {
    // A click is a gesture too. Pointer down is the usual way audio opens, but
    // it is not the only way a control is activated: assistive technology and
    // anything driving the page dispatch a click without a pointer, and
    // hanging the whole feature on one event type made those cases silent.
    unlock();
    // Deliberately not skipping a cancelled event. React attaches its
    // handlers to the root container, so by the time a click reaches the
    // document, every `<Link>` in the app has already called preventDefault
    // to route on the client. Treating that as "nothing happened" made the
    // sidebar, the assistant cards and every marketing link silent.
    const detail = (e as MouseEvent).detail;
    const clickEl = closest(e.target, `[${CLICK_ATTR}]`);
    const toggleEl = closest(e.target, `[${TOGGLE_ATTR}]`);
    const pressEl = closest(e.target, `[${PRESS_ATTR}]`);
    const claimed =
      clickEl !== null ||
      toggleEl !== null ||
      pressEl !== null ||
      closest(e.target, `[${RELEASE_ATTR}]`) !== null;
    if (clickEl && !silenced(clickEl) && !disabled(clickEl)) {
      const named = clickEl.getAttribute(CLICK_ATTR);
      play(isInteraction(named) ? named : "tap");
    } else if (detail === 0) {
      // Keyboard activation of a pressable control: no pointer, so no
      // press/release pair happened. `tap` is the keyboard's click.
      if (pressEl && !silenced(pressEl) && !disabled(pressEl)) play("tap");
    }
    if (toggleEl && !silenced(toggleEl) && !disabled(toggleEl)) {
      // A native checkbox has already flipped `checked` by the time `click`
      // dispatches, at capture and bubble alike, so its reading *is* the new
      // state. Only ARIA toggles need the before/after comparison.
      // An option in a radio group has no "off": choosing it is one event, and
      // the sibling it deselects is not a second one. `data-foley-toggle`
      // names the interaction for that case (`switch`); bare means on/off.
      const named = toggleEl.getAttribute(TOGGLE_ATTR);
      if (isInteraction(named)) {
        play(named);
      } else {
        const next = isNativeToggle(toggleEl)
          ? toggleEl.checked
          : nextToggleState(toggleBefore, readToggleState(toggleEl));
        if (next !== null) play(next ? "on" : "off");
      }
    }
    // The floor: a control nobody wrote a cue for still answers, with the
    // quiet tick. Only where something was actually activated, so a click on
    // the page background stays silent, and only when no other interaction
    // claimed this event, so a Button is press/release and not that plus a
    // tick. Foley's own 60ms per-cue cooldown absorbs the second click a
    // label dispatches onto its input.
    if (!claimed) {
      const activatable = closest(e.target, INTERACTIVE_SELECTOR);
      if (activatable && !silenced(activatable) && !disabled(activatable)) play("click");
    }
    toggleBefore = null;
  };

  const onKeyDown = (e: Event) => {
    unlock();
    if ((e as KeyboardEvent).key !== "Enter") return;
    const el = closest(e.target, `[${TYPE_ATTR}]`);
    if (el && !silenced(el) && !disabled(el)) play("complete");
  };

  doc.addEventListener("pointerdown", onPointerDown, { capture: true });
  doc.addEventListener("pointerup", onPointerUp, { capture: true });
  doc.addEventListener("click", onCaptureClick, { capture: true });
  doc.addEventListener("click", onClick);
  doc.addEventListener("keydown", onKeyDown, { capture: true });

  return {
    play,
    destroy() {
      destroyed = true;
      bencho?.destroy();
      doc.removeEventListener("pointerdown", onPointerDown, { capture: true });
      doc.removeEventListener("pointerup", onPointerUp, { capture: true });
      doc.removeEventListener("click", onCaptureClick, { capture: true });
      doc.removeEventListener("click", onClick);
      doc.removeEventListener("keydown", onKeyDown, { capture: true });
      setHapticTransport(null);
    },
  };
}
