import type { SurfaceFieldController } from "./controller";
import { subscribeSurfaceField } from "./controller";
import type { SurfaceFieldBox, SurfaceFieldEngine, SurfaceFieldEnv, SurfaceFieldPointer, SurfaceFieldRgb } from "./engine";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHAT ONLY THE PAGE CAN ANSWER: COLOURS, BOXES AND THE HAND.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The engine (`engine.ts`) draws; this file is everything it used to ask the
 * document for. It runs on the main thread on BOTH paths: with the engine
 * beside it, it calls the engine directly, exactly as the effect's own
 * listeners did; with the engine in a worker, it calls a sink that posts the
 * same calls across (`worker-client.ts`). The listeners, the observers and
 * the order they are hung in are the effect's, moved and not rewritten.
 */

export type SurfaceFieldColors = { fg: SurfaceFieldRgb; primary: SurfaceFieldRgb };
export type SurfaceFieldColorReader = {
  read(fg: SurfaceFieldRgb, primary: SurfaceFieldRgb): SurfaceFieldColors | null;
  readHue(primary: SurfaceFieldRgb): SurfaceFieldRgb | null;
};

/**
 * Resolve the foreground token to plain "r,g,b" via a 1×1 offscreen canvas,
 * robust no matter what colour syntax (oklch, rgb…) the browser computes.
 *
 * `tintHueVar` is the moving half of the light. `--brand-hue` is animated by
 * an ancestor and inherits down to this canvas, so reading it here is how the
 * ambient wash ends up on the same timeline as the mark's bands without either
 * one knowing about the other. `getComputedStyle` forces a style resolve,
 * which is not a thing to do 60 times a second for one number, so the engine
 * throttles its calls to every fourth frame while a hue is turning.
 */
export function createColorReader(canvas: HTMLCanvasElement, tintVar: string, tintHueVar: string | undefined, tintHue: number): SurfaceFieldColorReader {
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const probeCtx = probe.getContext("2d", { willReadFrequently: true });
  const toRgb = (color: string, fallback: SurfaceFieldRgb): SurfaceFieldRgb => {
    if (!probeCtx || !color) return fallback;
    probeCtx.clearRect(0, 0, 1, 1);
    /* Coverage for the probe, not a colour: it is what an unparseable
       string leaves behind, since the assignment below is then ignored. */
    probeCtx.fillStyle = "#000";
    probeCtx.fillStyle = color;
    probeCtx.fillRect(0, 0, 1, 1);
    const [r, g, b] = probeCtx.getImageData(0, 0, 1, 1).data;
    return [r, g, b];
  };
  const readHue = (primary: SurfaceFieldRgb) => {
    if (!probeCtx || !tintHueVar) return null;
    const raw = getComputedStyle(canvas).getPropertyValue(tintHueVar).trim();
    const angle = Number.parseFloat(raw) || 0;
    return toRgb(`oklch(0.72 0.19 ${tintHue + angle}deg)`, primary);
  };
  return {
    readHue,
    read(fg, primary) {
      if (!probeCtx) return null;
      const nextFg = toRgb(getComputedStyle(canvas).color, fg);
      const nextPrimary = tintHueVar
        ? readHue(primary) ?? primary
        : toRgb(getComputedStyle(document.documentElement).getPropertyValue(tintVar).trim(), primary);
      return { fg: nextFg, primary: nextPrimary };
    },
  };
}

/** A plain copy, because a `DOMRect` is a live-looking object and this one has to cross a thread. */
export const boxOf = (rect: DOMRect): SurfaceFieldBox => ({
  left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height,
});

/** The page itself as the engine's environment: today's path, call for call. */
export function mainThreadEnv(canvas: HTMLCanvasElement, fabric: HTMLCanvasElement | null, colors: SurfaceFieldColorReader): SurfaceFieldEnv {
  return {
    canvas,
    fabric,
    box: () => canvas.getBoundingClientRect(),
    dpr: () => window.devicePixelRatio,
    now: () => performance.now(),
    frame: callback => requestAnimationFrame(callback),
    cancelFrame: handle => cancelAnimationFrame(handle),
    setTimer: (callback, ms) => window.setTimeout(callback, ms),
    clearTimer: handle => window.clearTimeout(handle),
    readColor: colors.read,
    readTintHue: colors.readHue,
    sceneOrigin: scene => {
      const boardBox = scene?.root?.getBoundingClientRect();
      const canvasBox = canvas.getBoundingClientRect();
      return { x: (boardBox?.left ?? 0) - canvasBox.left, y: (boardBox?.top ?? 0) - canvasBox.top };
    },
  };
}

/** What the host calls. The engine is one; the worker's postbox is the other. */
export type SurfaceFieldSink = Pick<SurfaceFieldEngine,
  "resize" | "recolour" | "pointerMove" | "pointerOut" | "pointerDown" | "pointerUp" | "pointerCancel" |
  "focus" | "blur" | "visibility" | "hueAnimation" | "signal">;

const pointerOf = (e: PointerEvent, inRoot: boolean): SurfaceFieldPointer => ({
  pointerId: e.pointerId,
  clientX: e.clientX,
  clientY: e.clientY,
  buttons: e.buttons,
  button: e.button,
  pointerType: e.pointerType,
  inRoot,
  related: Boolean(e.relatedTarget),
});

/**
 * Hang the effect's observers and listeners on `sink`, and return the one
 * function that takes every one of them down again.
 *
 * `inRoot` is only worked out for a press, the one handler that reads it: a
 * `contains` walk on every move of the mouse would be paid for nothing.
 */
export function attachSurfaceFieldHost(
  canvas: HTMLCanvasElement,
  sink: SurfaceFieldSink,
  flags: { animating: boolean; looping: boolean; hearsOut: boolean },
  opts: { interactionRoot?: { current: HTMLElement | null }; controller?: SurfaceFieldController; tintHueVar?: string },
): () => void {
  const { interactionRoot, controller, tintHueVar } = opts;
  const { animating, looping, hearsOut } = flags;
  const onPointerMove = (e: PointerEvent) => sink.pointerMove(pointerOf(e, true));
  const onPointerOut = (e: PointerEvent) => sink.pointerOut(pointerOf(e, true));
  const onPointerDown = (e: PointerEvent) => {
    const target = e.target;
    const inRoot = !interactionRoot || (target instanceof Node && Boolean(interactionRoot.current?.contains(target)));
    sink.pointerDown(pointerOf(e, inRoot));
  };
  const onPointerUp = (e: PointerEvent) => sink.pointerUp(pointerOf(e, true));
  const onPointerCancel = (e: PointerEvent) => sink.pointerCancel(e.pointerId);
  const onFocus = () => sink.focus();
  const onBlur = () => sink.blur();
  const onVisibility = () => sink.visibility(document.hidden);
  /**
   * Whether anything is currently TURNING the hue. IT IS EVENT-DRIVEN AND NOT
   * A POLL, because the read forces a synchronous style flush. `spectrum-hue`
   * is the only keyframe that moves this property, and CSS animation events
   * bubble, so one listener catches a room anywhere above this canvas.
   */
  const onHueAnimation = (e: AnimationEvent) => {
    if (e.animationName !== "spectrum-hue") return;
    if (!(e.target instanceof Node) || !e.target.contains(canvas)) return;
    sink.hueAnimation(e.type === "animationstart");
  };

  const resizeObserver = new ResizeObserver(() => sink.resize());
  resizeObserver.observe(canvas);
  const themeObserver = new MutationObserver(() => sink.recolour());
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  const unsubscribe = controller ? subscribeSurfaceField(controller, signal => sink.signal(signal)) : null;
  if (looping) {
    /* THE HAND IS THE LIGHT'S, AND A TEXTURE HAS NO LIGHT. `still` subscribes
       to visibility because that is what lets it stop costing anything, and
       to nothing else. */
    if (animating) {
      window.addEventListener("pointermove", onPointerMove, { passive: true, capture: true });
      if (hearsOut) window.addEventListener("pointerout", onPointerOut, true);
      window.addEventListener("pointerdown", onPointerDown, { passive: true, capture: true });
      window.addEventListener("pointerup", onPointerUp, { passive: true, capture: true });
      window.addEventListener("pointercancel", onPointerCancel, { passive: true, capture: true });
      window.addEventListener("focus", onFocus);
      window.addEventListener("blur", onBlur);
    }
    document.addEventListener("visibilitychange", onVisibility);
    if (tintHueVar) {
      document.addEventListener("animationstart", onHueAnimation, true);
      document.addEventListener("animationend", onHueAnimation, true);
      document.addEventListener("animationcancel", onHueAnimation, true);
    }
  }
  return () => {
    resizeObserver.disconnect();
    themeObserver.disconnect();
    unsubscribe?.();
    window.removeEventListener("pointermove", onPointerMove, true);
    if (hearsOut) window.removeEventListener("pointerout", onPointerOut, true);
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerCancel, true);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("animationstart", onHueAnimation, true);
    document.removeEventListener("animationend", onHueAnimation, true);
    document.removeEventListener("animationcancel", onHueAnimation, true);
  };
}
