import type { CueName } from "@foleyjs/core";

import { HAPTIC_PATTERNS, haptic, setHapticTransport } from "./haptics";
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
 * document, the lazy loading of both libraries, and the bridge from an
 * interaction to Foley's `play()` and WebHaptics' `trigger()`.
 *
 * Why not Foley's own `bind()`: it decides a toggle's state from `aria-pressed`
 * only (Base UI switches and checkboxes speak `aria-checked`), it has no way to
 * silence a subtree (the marketing site's drawn console mock must not answer a
 * press), and it does not know about mute, hidden tabs or haptics. So the
 * attribute names are Foley's, the binder is ours, and `bind()` is never
 * called: calling it too would double every cue.
 *
 * Both libraries are imported dynamically inside the first user gesture. A
 * page nobody touches downloads neither, and a server bundle can never
 * evaluate a module that reaches for `AudioContext`.
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

export interface FeedbackRuntime {
  /** Play an interaction from code (toasts, stream lifecycle, snaps). */
  play(interaction: Interaction): void;
  /** Whether the first gesture has happened and the libraries are loading or loaded. */
  readonly unlocked: boolean;
  destroy(): void;
}

export interface AttachOptions {
  isMuted: () => boolean;
  /** Test seam: replaces the dynamic imports. */
  loadFoley?: () => Promise<Pick<FoleyModule, "play" | "set">>;
  loadHaptics?: () => Promise<{ trigger: (input: unknown) => Promise<void> } | null>;
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

function closestAttr(target: EventTarget | null, attr: string): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest(`[${attr}]`);
}

/** The nearest ancestor that activates on a click, if the target is inside one. */
function interactive(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest(INTERACTIVE_SELECTOR);
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
  let unlocked = false;
  let destroyed = false;
  let pendingCue: {
    cue: CueName;
    options: CueOptions | undefined;
    theme: FoleyTheme | undefined;
  } | null = null;
  let hapticsReady = false;
  const successCoalescer = createCoalescer(SUCCESS_COALESCE_MS);

  const loadFoley = options.loadFoley ?? (() => import("@foleyjs/core"));
  const loadHaptics =
    options.loadHaptics ??
    (async () => {
      const mod = await import("web-haptics");
      // `showSwitch: false` keeps the iOS `<input switch>` WebHaptics clicks
      // for the Taptic Engine out of sight; it is still there and still works.
      return new mod.WebHaptics({ showSwitch: false });
    });

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
    if (interaction === "success" && !successCoalescer.allow("success")) return;
    // A copy that also toasts ("Assistant ID copied") is still one event, and
    // `glide` is the one the button asked for, so it claims the slot the
    // toast's `success` would have taken.
    if (interaction === "copy") successCoalescer.allow("success");
    const decision = decide(interaction, environment(), { muted: options.isMuted() });
    if (decision.cue) {
      if (foley) {
        performCue(foley, decision.cue, decision.options, decision.theme);
      } else {
        // The gesture that unlocks audio is usually also the one that should
        // sound. Keep the last cue until Foley arrives; a queue would replay a
        // whole burst late, which is worse than one cue slightly late.
        pendingCue = {
          cue: decision.cue,
          options: decision.options,
          theme: decision.theme,
        };
      }
    }
    if (decision.haptic) haptic(decision.haptic);
  }

  function unlock(): void {
    if (unlocked || destroyed) return;
    unlocked = true;
    void loadFoley()
      .then((mod) => {
        if (destroyed) return;
        foley = mod;
        mod.set({ ...FOLEY_SETTINGS });
        if (pendingCue && !options.isMuted() && !doc.hidden) {
          performCue(mod, pendingCue.cue, pendingCue.options, pendingCue.theme);
        }
        pendingCue = null;
      })
      .catch(() => {
        // No audio is a degraded state, not an error worth a console line.
      });
    void loadHaptics()
      .then((instance) => {
        if (destroyed || !instance) return;
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
    const el = closestAttr(e.target, TOGGLE_ATTR);
    toggleBefore = el ? readToggleState(el) : null;
  };

  const onPointerDown = (e: Event) => {
    unlock();
    const el = closestAttr(e.target, PRESS_ATTR);
    if (!el || silenced(el) || disabled(el)) return;
    play("press");
  };

  const onPointerUp = (e: Event) => {
    const el = closestAttr(e.target, RELEASE_ATTR);
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
    const clickEl = closestAttr(e.target, CLICK_ATTR);
    const claimed =
      clickEl !== null ||
      closestAttr(e.target, TOGGLE_ATTR) !== null ||
      closestAttr(e.target, PRESS_ATTR) !== null ||
      closestAttr(e.target, RELEASE_ATTR) !== null;
    if (clickEl && !silenced(clickEl) && !disabled(clickEl)) {
      const named = clickEl.getAttribute(CLICK_ATTR);
      play(isInteraction(named) ? named : "tap");
    } else if (detail === 0) {
      // Keyboard activation of a pressable control: no pointer, so no
      // press/release pair happened. `tap` is the keyboard's click.
      const pressEl = closestAttr(e.target, PRESS_ATTR);
      if (pressEl && !silenced(pressEl) && !disabled(pressEl)) play("tap");
    }
    const toggleEl = closestAttr(e.target, TOGGLE_ATTR);
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
      const activatable = interactive(e.target);
      if (activatable && !silenced(activatable) && !disabled(activatable)) play("click");
    }
    toggleBefore = null;
  };

  const onKeyDown = (e: Event) => {
    unlock();
    if ((e as KeyboardEvent).key !== "Enter") return;
    const el = closestAttr(e.target, TYPE_ATTR);
    if (el && !silenced(el) && !disabled(el)) play("complete");
  };

  doc.addEventListener("pointerdown", onPointerDown, { capture: true });
  doc.addEventListener("pointerup", onPointerUp, { capture: true });
  doc.addEventListener("click", onCaptureClick, { capture: true });
  doc.addEventListener("click", onClick);
  doc.addEventListener("keydown", onKeyDown, { capture: true });

  return {
    play,
    get unlocked() {
      return unlocked;
    },
    destroy() {
      destroyed = true;
      doc.removeEventListener("pointerdown", onPointerDown, { capture: true });
      doc.removeEventListener("pointerup", onPointerUp, { capture: true });
      doc.removeEventListener("click", onCaptureClick, { capture: true });
      doc.removeEventListener("click", onClick);
      doc.removeEventListener("keydown", onKeyDown, { capture: true });
      setHapticTransport(null);
    },
  };
}
