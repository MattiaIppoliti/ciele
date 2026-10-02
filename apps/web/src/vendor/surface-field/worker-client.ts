import { boxOf, type SurfaceFieldColorReader, type SurfaceFieldSink } from "./dom";
import { SEED_FG, SEED_PRIMARY, type SurfaceFieldBox, type SurfaceFieldCanvas, type SurfaceFieldEngine, type SurfaceFieldOptions, type SurfaceFieldPoint, type SurfaceFieldPointer, type SurfaceFieldRgb } from "./engine";
import type { FieldItem, FieldPointerItem, FromFieldWorker, ToFieldWorker } from "./worker-runtime";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE MAIN THREAD'S HALF: EVERY CALL THE ENGINE WOULD HAVE HAD, ONE POST A FRAME.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The host (`dom.ts`) cannot tell this from the engine: it is the same sink.
 * Each call is written down with what the engine would have read off the page
 * at that instant (the canvas box, the clock) and the whole list goes to the
 * worker once per animation frame, in order.
 *
 * WHAT MAY BE MERGED IS ONLY WHAT PROVABLY CHANGES NOTHING. The engine's
 * handlers are mostly last-value (where the hand is, which rectangles the
 * board has), and two of those in a row are one. But a few of them are
 * TRANSITIONS, and a merged transition moves: a release heard as a move with
 * no buttons, the first move past the drag slop that turns a press into a
 * carry, a move that left the canvas and took the light's target with it.
 * Those are never merged. Chromium already delivers one pointermove per frame,
 * so in practice the list is one move, one footprint and one scene.
 *
 * AND SOME CALLS DO NOT WAIT FOR THE FRAME. A resize, a new theme, the start
 * and a page going hidden are posted at once: the main-thread field painted
 * those synchronously, and a hidden page has no frame to wait for.
 */

/** The drag slop, the engine's `DRAG_PX`: past it a press is a carry. */
const DRAG_PX = 4;

export type WorkerSinkDeps = {
  post(message: ToFieldWorker, transfer?: Transferable[]): void;
  /** The canvas's viewport box, now. */
  box(): SurfaceFieldBox;
  dpr(): number;
  now(): number;
  frame(callback: () => void): number;
  cancelFrame(handle: number): void;
  colors: SurfaceFieldColorReader;
  /** Where a scene's root sits relative to the canvas, now. */
  sceneOrigin(root: NonNullable<ScenePayload>["root"]): SurfaceFieldPoint;
};
type ScenePayload = { root?: { getBoundingClientRect(): { left: number; top: number } }; rects: readonly unknown[] } | null;

export type WorkerSinkStart = {
  canvases: { id: number; canvas: SurfaceFieldCanvas }[];
  transfer: Transferable[];
  canvas: number;
  fabric: number | null;
  options: SurfaceFieldOptions;
  pending: SurfaceFieldPoint[];
  timeOrigin: number;
};

export type WorkerSink = SurfaceFieldSink & Pick<SurfaceFieldEngine, "begin" | "viewportProp" | "ripple" | "dispose"> & {
  /** Post what is queued now, instead of at the next frame. */
  flush(): void;
};

const inside = (e: SurfaceFieldPointer, box: SurfaceFieldBox) =>
  e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;

export function createWorkerSink(deps: WorkerSinkDeps, start: WorkerSinkStart): WorkerSink {
  let queue: FieldItem[] = [];
  let scheduled = 0;
  let disposed = false;
  /* The engine's colours as it will hold them, so each read here resolves
     against the same fallbacks the engine's own read would have used. */
  let fg: SurfaceFieldRgb = [...SEED_FG];
  let primary: SurfaceFieldRgb = [...SEED_PRIMARY];
  let sceneRoot: NonNullable<ScenePayload>["root"] | null = null;
  /* Scene items whose origin is measured at the flush, once, for the last one. */
  const sceneItems = new Set<FieldItem>();
  /* A press this side can see, for the merge rules above. */
  let press: { pointerId: number; x: number; y: number; pastSlop: boolean } | null = null;
  const moveSlop = new WeakMap<FieldItem, boolean>();
  let hueMoving = false;
  let hueTick = 0;
  let hueFrame = 0;

  const readColors = () => {
    const next = deps.colors.read(fg, primary);
    if (!next) return null;
    fg = next.fg;
    primary = next.primary;
    return next;
  };
  const readHue = () => {
    const next = deps.colors.readHue(primary);
    if (next) primary = next;
    return next;
  };

  const flush = () => {
    if (scheduled) { deps.cancelFrame(scheduled); scheduled = 0; }
    if (disposed || !queue.length) return;
    if (sceneItems.size) {
      const origin = sceneRoot ? deps.sceneOrigin(sceneRoot) : null;
      for (const item of sceneItems) {
        if (item.k === "signal" && item.signal.kind === "scene" && item.signal.value && origin) item.signal.value.origin = origin;
      }
      sceneItems.clear();
    }
    const items = queue;
    queue = [];
    deps.post({ type: "batch", items });
  };
  const schedule = () => {
    if (!scheduled && !disposed) scheduled = deps.frame(() => { scheduled = 0; flush(); });
  };
  const push = (item: FieldItem, now = false) => {
    if (disposed) return;
    queue.push(item);
    if (now) flush();
    else schedule();
  };
  const last = () => queue[queue.length - 1];

  const pointer = (k: FieldPointerItem["k"], e: SurfaceFieldPointer) => {
    const item: FieldPointerItem = { k, e, box: deps.box(), t: deps.now() };
    if (k === "down" && e.button === 0) press = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, pastSlop: false };
    if (k === "move") {
      const pressed = press?.pointerId === e.pointerId ? press : null;
      /* Whether the carry was already decided BEFORE this move: only then is
         this move's own slop test not a transition. */
      moveSlop.set(item, !pressed || pressed.pastSlop);
      if (pressed && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > DRAG_PX) pressed.pastSlop = true;
      const prev = last();
      if (prev?.k === "move" && prev.e.pointerId === e.pointerId && prev.e.buttons === e.buttons &&
          prev.e.pointerType === e.pointerType && inside(prev.e, prev.box) === inside(e, item.box) &&
          (!pressed || (e.buttons !== 0 && moveSlop.get(prev) === true))) {
        item.t = prev.t;
        moveSlop.set(item, moveSlop.get(prev) === true);
        queue[queue.length - 1] = item;
        schedule();
        return;
      }
    }
    if ((k === "up") && press?.pointerId === e.pointerId) press = null;
    push(item);
  };

  const huePoll = () => {
    hueFrame = 0;
    if (!hueMoving || disposed) return;
    /* Every fourth frame, as the engine reads it: the value is there when it asks. */
    if ((hueTick = (hueTick + 1) & 3) === 0) {
      const next = readHue();
      if (next) push({ k: "hue", primary: next });
    }
    hueFrame = deps.frame(huePoll);
  };

  const box = deps.box();
  const colors = readColors();
  deps.post({
    type: "start",
    canvases: start.canvases,
    canvas: start.canvas,
    fabric: start.fabric,
    options: start.options,
    pending: start.pending,
    box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height },
    dpr: deps.dpr(),
    colors,
    hue: null,
    origin: null,
    timeOrigin: start.timeOrigin,
    t: deps.now(),
  }, start.transfer);

  const recolour = () => {
    const next = readColors();
    if (next) queue.push({ k: "colors", colors: next });
    push({ k: "recolour", t: deps.now() }, true);
  };

  return {
    flush,
    resize() {
      const next = readColors();
      if (next) queue.push({ k: "colors", colors: next });
      push({ k: "resize", box: deps.box(), dpr: deps.dpr(), origin: sceneRoot ? deps.sceneOrigin(sceneRoot) : null, t: deps.now() }, true);
    },
    recolour,
    pointerMove: e => pointer("move", e),
    pointerOut: e => pointer("out", e),
    pointerDown: e => pointer("down", e),
    pointerUp: e => pointer("up", e),
    pointerCancel(pointerId) {
      if (press?.pointerId === pointerId) press = null;
      push({ k: "cancel", pointerId, t: deps.now() });
    },
    focus: () => push({ k: "focus", t: deps.now() }),
    blur: () => push({ k: "blur", t: deps.now() }),
    visibility: hidden => push({ k: "visibility", hidden, t: deps.now() }, true),
    hueAnimation(moving) {
      /* Read on both edges, as the engine does: on the way in so the first
         frame is already right, on the way out so it settles on the rest. */
      const next = readHue();
      if (next) queue.push({ k: "hue", primary: next });
      push({ k: "hueAnimation", moving, t: deps.now() });
      hueMoving = moving;
      if (moving && !hueFrame) hueFrame = deps.frame(huePoll);
    },
    signal(signal) {
      const t = deps.now();
      const prev = last();
      if (signal.kind === "theme") { recolour(); return; }
      if (signal.kind === "scene") {
        const value = signal.value;
        sceneRoot = value?.root ?? null;
        const item: FieldItem = { k: "signal", t, signal: { kind: "scene", value: value ? { rects: value.rects } : null } };
        if (prev?.k === "signal" && prev.signal.kind === "scene") {
          sceneItems.delete(prev);
          item.t = prev.t;
          queue[queue.length - 1] = item;
          sceneItems.add(item);
          schedule();
          return;
        }
        sceneItems.add(item);
        push(item);
        return;
      }
      if (signal.kind === "footprint") {
        const value = signal.value;
        if (prev?.k === "signal" && prev.signal.kind === "footprint" && !prev.signal.value.initial && !value.initial &&
            prev.signal.value.pointerId === value.pointerId && Boolean(prev.signal.value.suppressRipple) === Boolean(value.suppressRipple)) {
          prev.signal = { kind: "footprint", value };
          schedule();
          return;
        }
      }
      if (signal.kind === "preview") {
        const value = signal.value;
        if (prev?.k === "signal" && prev.signal.kind === "preview" && prev.signal.value.rect && value.rect &&
            !prev.signal.value.committed && !value.committed) {
          prev.signal = { kind: "preview", value };
          schedule();
          return;
        }
      }
      /* Links are state, like the camera: two in one frame are the second. */
      if (signal.kind === "links" && prev?.k === "signal" && prev.signal.kind === "links") {
        prev.signal = { kind: "links", value: signal.value };
        schedule();
        return;
      }
      if (signal.kind === "viewport" && prev?.k === "signal" && prev.signal.kind === "viewport") {
        prev.signal = { kind: "viewport", value: signal.value };
        schedule();
        return;
      }
      push({ k: "signal", t, signal });
    },
    viewportProp(viewport) {
      const prev = last();
      if (prev?.k === "viewportProp") { prev.viewport = viewport; schedule(); return; }
      push({ k: "viewportProp", viewport, t: deps.now() });
    },
    ripple: (x, y) => push({ k: "ripple", x, y, t: deps.now() }),
    begin: () => push({ k: "begin", t: deps.now() }, true),
    dispose() {
      if (disposed) return;
      if (scheduled) deps.cancelFrame(scheduled);
      if (hueFrame) deps.cancelFrame(hueFrame);
      scheduled = hueFrame = 0;
      queue = [];
      disposed = true;
      deps.post({ type: "stop" });
    },
  };
}

/**
 * ═══ ONE WORKER PER MOUNTED FIELD, AND IT OWNS THE CANVASES FOR GOOD ═══════
 *
 * `transferControlToOffscreen` is once per element: after it the page can
 * neither draw on that canvas nor take it back. So the lane outlives the
 * effect (a changed prop restarts the engine in the same worker) and dies
 * with the component. A lane that fails has to be abandoned WITH its
 * canvases, which is why the component keys them (see `SurfaceField`).
 */
export type WorkerLane = {
  worker: Worker;
  ids: WeakMap<HTMLCanvasElement, number>;
  next: number;
  /** Set by the effect in charge; the lane calls it once on any failure. */
  onFail: ((reason: string) => void) | null;
  /** A deferred terminate, cancelled when a strict-mode remount takes the lane back. */
  kill: ReturnType<typeof setTimeout> | null;
};

export function createWorkerLane(factory: () => Worker): WorkerLane {
  const worker = factory();
  const lane: WorkerLane = { worker, ids: new WeakMap(), next: 1, onFail: null, kill: null };
  const fail = (reason: string) => {
    const report = lane.onFail;
    lane.onFail = null;
    report?.(reason);
  };
  worker.onmessage = (event: MessageEvent<FromFieldWorker>) => { if (event.data?.type === "error") fail(event.data.message); };
  worker.onerror = event => { event.preventDefault(); fail(event.message || "worker error"); };
  worker.onmessageerror = () => fail("message error");
  return lane;
}

/** Whether this page can move a canvas into a worker at all. */
export const canTransfer = (canvas: HTMLCanvasElement) =>
  typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined" &&
  typeof canvas.transferControlToOffscreen === "function";

export function startWorkerField(
  lane: WorkerLane,
  canvas: HTMLCanvasElement,
  fabric: HTMLCanvasElement | null,
  options: SurfaceFieldOptions,
  colors: SurfaceFieldColorReader,
  pending: SurfaceFieldPoint[],
  handed: WeakSet<HTMLCanvasElement>,
): WorkerSink {
  const canvases: WorkerSinkStart["canvases"] = [];
  const transfer: Transferable[] = [];
  const idOf = (element: HTMLCanvasElement) => {
    let id = lane.ids.get(element);
    if (id === undefined) {
      const offscreen = element.transferControlToOffscreen();
      handed.add(element);
      id = lane.next++;
      lane.ids.set(element, id);
      canvases.push({ id, canvas: offscreen });
      transfer.push(offscreen);
    }
    return id;
  };
  const canvasId = idOf(canvas);
  const fabricId = fabric ? idOf(fabric) : null;
  return createWorkerSink({
    post: (message, list) => lane.worker.postMessage(message, list ?? []),
    box: () => boxOf(canvas.getBoundingClientRect()),
    dpr: () => window.devicePixelRatio,
    now: () => performance.now(),
    frame: callback => requestAnimationFrame(callback),
    cancelFrame: handle => cancelAnimationFrame(handle),
    colors,
    sceneOrigin: root => {
      const boardBox = root?.getBoundingClientRect();
      const canvasBox = canvas.getBoundingClientRect();
      return { x: (boardBox?.left ?? 0) - canvasBox.left, y: (boardBox?.top ?? 0) - canvasBox.top };
    },
  }, { canvases, transfer, canvas: canvasId, fabric: fabricId, options, pending, timeOrigin: performance.timeOrigin });
}
