import {
  startSurfaceField,
  type SurfaceFieldBox,
  type SurfaceFieldCanvas,
  type SurfaceFieldEngine,
  type SurfaceFieldEngineSignal,
  type SurfaceFieldEnv,
  type SurfaceFieldMemory,
  type SurfaceFieldOptions,
  type SurfaceFieldPoint,
  type SurfaceFieldPointer,
  type SurfaceFieldRgb,
} from "./engine";
import type { SurfaceFieldViewport } from "./viewport";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE WORKER'S HALF: A POSTBOX IN FRONT OF THE SAME ENGINE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Nothing here draws. It keeps what the page would have answered (the last
 * box, the last colours, where the board sits) and replays the host's calls
 * into `startSurfaceField` in the order they happened, each one at the
 * instant it happened.
 *
 * THE ENGINE HERE RUNS ON THE PAGE'S CLOCK, NOT THIS THREAD'S. A worker's
 * `performance` has its own origin, so `toPage` moves every time the engine
 * sees (this thread's frames, `now`) onto the main thread's timeline, and an
 * event's own stamp `t` is used as it came. A ring asked for at a press
 * therefore starts at the press and not at the message, and the breath, whose
 * phase is the absolute clock, is at the same point of its cycle on both
 * paths at the same instant.
 *
 * NO DOM AND NO `self` IN THIS FILE, so the node tests drive it with a fake
 * scope and compare its drawing, call for call, with the engine run directly.
 */

export type FieldColors = { fg: SurfaceFieldRgb; primary: SurfaceFieldRgb };
export type FieldPointerItem = { k: "move" | "out" | "down" | "up"; e: SurfaceFieldPointer; box: SurfaceFieldBox; t: number };
export type FieldItem =
  | FieldPointerItem
  | { k: "resize"; box: SurfaceFieldBox; dpr: number; origin: SurfaceFieldPoint | null; t: number }
  | { k: "colors"; colors: FieldColors }
  | { k: "hue"; primary: SurfaceFieldRgb }
  | { k: "recolour"; t: number }
  | { k: "cancel"; pointerId: number; t: number }
  | { k: "focus" | "blur"; t: number }
  | { k: "visibility"; hidden: boolean; t: number }
  | { k: "hueAnimation"; moving: boolean; t: number }
  | { k: "signal"; signal: SurfaceFieldEngineSignal; t: number }
  | { k: "viewportProp"; viewport: SurfaceFieldViewport | undefined; t: number }
  | { k: "ripple"; x: number; y: number; t: number }
  | { k: "begin"; t: number };

export type ToFieldWorker =
  | {
      type: "start";
      /** Canvases this message hands over for the first time. Kept by id for the worker's life. */
      canvases: { id: number; canvas: SurfaceFieldCanvas }[];
      canvas: number;
      fabric: number | null;
      options: SurfaceFieldOptions;
      pending: SurfaceFieldPoint[];
      box: SurfaceFieldBox;
      dpr: number;
      colors: FieldColors | null;
      hue: SurfaceFieldRgb | null;
      origin: SurfaceFieldPoint | null;
      /** `performance.timeOrigin` on the main thread, for `toPage`. */
      timeOrigin: number;
      t: number;
    }
  | { type: "batch"; items: FieldItem[] }
  | { type: "stop" };

export type FromFieldWorker = { type: "error"; message: string };

export type FieldWorkerScope = {
  postMessage(message: FromFieldWorker): void;
  performance: { now(): number; timeOrigin: number };
  requestAnimationFrame?: (callback: (time: number) => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(handle: number): void;
};

/**
 * One per worker, and one worker per mounted field: the canvases were handed
 * over once and cannot be handed back, so a field whose options change stops
 * its engine and starts another on the same canvases here.
 */
export function createFieldWorkerRuntime(scope: FieldWorkerScope) {
  const canvases = new Map<number, SurfaceFieldCanvas>();
  /* What outlives one engine, as it outlives one effect run on the main
     thread: the floor that is carried from camera to camera, and rings asked
     for before anything could draw them. */
  const memory: SurfaceFieldMemory = { pending: { current: [] }, floor: { current: null } };
  let engine: SurfaceFieldEngine | null = null;
  let box: SurfaceFieldBox = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  let dpr = 1;
  let colors: FieldColors | null = null;
  let hue: SurfaceFieldRgb | null = null;
  let origin: SurfaceFieldPoint = { x: 0, y: 0 };
  /* Add to this thread's clock to read the page's. */
  let toPage = 0;
  /* While an item is being replayed, "now" is when it happened. */
  let eventTime: number | null = null;
  let dead = false;

  const fail = (error: unknown) => {
    if (dead) return;
    dead = true;
    try { engine?.dispose(); } catch { /* already failing */ }
    engine = null;
    scope.postMessage({ type: "error", message: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error) });
  };
  const guarded = <A extends unknown[]>(run: (...args: A) => void) => (...args: A) => {
    if (dead) return;
    try { run(...args); } catch (error) { fail(error); }
  };

  /* A dedicated worker in Chromium has its own animation frames, driven by
     the OffscreenCanvas it draws into. A host that has none gets a 16ms
     timer, the one clock every worker has. */
  const raf = scope.requestAnimationFrame?.bind(scope);
  const caf = scope.cancelAnimationFrame?.bind(scope);
  const pageNow = () => scope.performance.now() + toPage;
  const frame = (callback: (time: number) => void) => raf
    ? raf(guarded((time: number) => callback(time + toPage)))
    : scope.setTimeout(guarded(() => callback(pageNow())), 16);
  const cancelFrame = (handle: number) => { if (raf && caf) caf(handle); else scope.clearTimeout(handle); };

  const envFor = (canvas: SurfaceFieldCanvas, fabric: SurfaceFieldCanvas | null): SurfaceFieldEnv => ({
    canvas,
    fabric,
    box: () => box,
    dpr: () => dpr,
    now: () => eventTime ?? pageNow(),
    frame,
    cancelFrame,
    setTimer: (callback, ms) => scope.setTimeout(guarded(callback), ms),
    clearTimer: handle => scope.clearTimeout(handle),
    readColor: () => colors,
    readTintHue: () => hue,
    sceneOrigin: () => origin,
  });

  const at = (t: number) => { eventTime = t; };

  const apply = (item: FieldItem) => {
    const e = engine;
    if (!e) {
      /* Between a stop and a start only the page's answers are worth keeping. */
      if (item.k === "colors") colors = item.colors;
      else if (item.k === "hue") hue = item.primary;
      else if (item.k === "ripple") memory.pending.current.push({ x: item.x, y: item.y });
      return;
    }
    switch (item.k) {
      case "colors": colors = item.colors; return;
      case "hue": hue = item.primary; return;
      case "resize":
        box = item.box;
        dpr = item.dpr;
        if (item.origin) origin = item.origin;
        at(item.t); e.resize(); return;
      case "recolour": at(item.t); e.recolour(); return;
      case "move": box = item.box; at(item.t); e.pointerMove(item.e); return;
      case "out": box = item.box; at(item.t); e.pointerOut(item.e); return;
      case "down": box = item.box; at(item.t); e.pointerDown(item.e); return;
      case "up": box = item.box; at(item.t); e.pointerUp(item.e); return;
      case "cancel": at(item.t); e.pointerCancel(item.pointerId); return;
      case "focus": at(item.t); e.focus(); return;
      case "blur": at(item.t); e.blur(); return;
      case "visibility": at(item.t); e.visibility(item.hidden); return;
      case "hueAnimation": at(item.t); e.hueAnimation(item.moving); return;
      case "signal":
        if (item.signal.kind === "scene" && item.signal.value?.origin) origin = item.signal.value.origin;
        at(item.t); e.signal(item.signal); return;
      case "viewportProp": at(item.t); e.viewportProp(item.viewport); return;
      case "ripple": at(item.t); e.ripple(item.x, item.y); return;
      case "begin": at(item.t); e.begin(); return;
    }
  };

  const handle = (message: ToFieldWorker) => {
    if (dead) return;
    try {
      if (message.type === "start") {
        engine?.dispose();
        engine = null;
        for (const { id, canvas } of message.canvases) canvases.set(id, canvas);
        const canvas = canvases.get(message.canvas);
        const fabric = message.fabric === null ? null : canvases.get(message.fabric) ?? null;
        if (!canvas) throw new Error(`surface-field worker: no canvas ${message.canvas}`);
        toPage = scope.performance.timeOrigin - message.timeOrigin;
        box = message.box;
        dpr = message.dpr;
        colors = message.colors ?? colors;
        hue = message.hue ?? hue;
        origin = message.origin ?? origin;
        memory.pending.current.push(...message.pending);
        at(message.t);
        engine = startSurfaceField(envFor(canvas, fabric), message.options, memory);
        if (!engine) throw new Error("surface-field worker: the canvas has no 2d context");
      } else if (message.type === "stop") {
        engine?.dispose();
        engine = null;
      } else {
        for (const item of message.items) apply(item);
      }
    } catch (error) {
      fail(error);
    } finally {
      eventTime = null;
    }
  };

  return { handle };
}
