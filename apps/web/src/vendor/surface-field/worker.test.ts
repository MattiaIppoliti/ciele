import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SurfaceFieldColorReader } from "./dom";
import { startSurfaceField, type SurfaceFieldBox, type SurfaceFieldCanvas, type SurfaceFieldEngineScene, type SurfaceFieldOptions, type SurfaceFieldPointer, type SurfaceFieldRgb } from "./engine";
import { createWorkerSink, type WorkerSink } from "./worker-client";
import { createFieldWorkerRuntime, type FromFieldWorker, type ToFieldWorker } from "./worker-runtime";

/* ═══ THE SAME PICTURE ON BOTH THREADS, CALL FOR CALL ════════════════════
   .
   Node has no canvas, so the canvas here is a recorder: every call and every
   property written on either context, with its exact arguments, in order.
   Two drawings that produce the same list are the same pixels on any
   rasteriser, and that is a stronger statement than a screenshot diff with a
   tolerance.
   .
   One field is driven with the engine beside it, as the main thread does; the
   other through the whole worker path: the sink that queues and merges, a
   structured clone, and the runtime that replays into its own engine on a
   clock whose origin is a second away. Same inputs, same frames. */

type Log = string[];
const fmt = (value: unknown): string =>
  value instanceof FakePath ? `P[${value.ops.join(";")}]` : typeof value === "string" ? JSON.stringify(value) : String(value);

class FakePath {
  ops: string[] = [];
  constructor() {
    return new Proxy(this, {
      get: (target, key) => key in target ? (target as unknown as Record<string | symbol, unknown>)[key]
        : (...args: unknown[]) => { target.ops.push(`${String(key)}(${args.map(fmt).join(",")})`); },
    });
  }
}

const recorder = (name: string, log: Log) => new Proxy({} as Record<string, unknown>, {
  get: (_, key) => typeof key === "string" ? (...args: unknown[]) => { log.push(`${name}.${key}(${args.map(fmt).join(",")})`); } : undefined,
  set: (_, key, value) => { log.push(`${name}.${String(key)}=${fmt(value)}`); return true; },
});

const fakeCanvas = (name: string, log: Log): SurfaceFieldCanvas & { toString(): string } => {
  let width = 300, height = 150;
  const ctx = recorder(name, log);
  return {
    get width() { return width; },
    set width(value) { width = value; log.push(`${name}.width=${value}`); },
    get height() { return height; },
    set height(value) { height = value; log.push(`${name}.height=${value}`); },
    getContext: () => ctx,
    toString: () => name,
  };
};

/* The layers' masters (`engine.ts#present`), recorded into the log of the
   field being driven, so their drawing and the presents sit in order with the
   visible canvases' calls. The engine makes the dots' master first. */
let activeLog: Log = [];
const mastersMade = new WeakMap<Log, number>();
class FakeMaster {
  constructor(width: number, height: number) {
    const log = activeLog;
    const n = mastersMade.get(log) ?? 0;
    mastersMade.set(log, n + 1);
    const name = n === 0 ? "dotsMaster" : "fabricMaster";
    log.push(`${name}(${width},${height})`);
    const canvas = fakeCanvas(name, log);
    return canvas as unknown as FakeMaster;
  }
}

/* A clock and two queues, the page's and (for the worker) the worker's. */
type Timer = { due: number; run: () => void; id: number };
const clockQueue = () => {
  let next = 1;
  const frames = new Map<number, (time: number) => void>();
  const timers: Timer[] = [];
  return {
    frame(callback: (time: number) => void) { const id = next++; frames.set(id, callback); return id; },
    cancelFrame(id: number) { frames.delete(id); },
    setTimer(run: () => void, ms: number, now: number) { const id = next++; timers.push({ due: now + ms, run, id }); return id; },
    clearTimer(id: number) { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    runFrames(time: number) { const due = [...frames.values()]; frames.clear(); for (const run of due) run(time); },
    runTimers(now: number) {
      for (;;) {
        timers.sort((a, b) => a.due - b.due || a.id - b.id);
        if (!timers.length || timers[0].due > now) return;
        timers.shift()!.run();
      }
    },
  };
};

const LIGHT = { fg: [23, 23, 23] as SurfaceFieldRgb, primary: [230, 120, 50] as SurfaceFieldRgb };
const DARK = { fg: [236, 236, 240] as SurfaceFieldRgb, primary: [120, 180, 250] as SurfaceFieldRgb };

type World = {
  now: number;
  box: SurfaceFieldBox;
  board: { left: number; top: number };
  theme: typeof LIGHT;
};
const reader = (world: World): SurfaceFieldColorReader => ({
  read: () => ({ fg: [...world.theme.fg], primary: [...world.theme.primary] }),
  readHue: () => null,
});
const boxAt = (left: number, top: number, width: number, height: number): SurfaceFieldBox =>
  ({ left, top, width, height, right: left + width, bottom: top + height });

// A representative connected grid, rather than production density: each test
// retains every draw call over hundreds of frames for exact parity checks.
// 44px still exercises horizontal, vertical and diagonal links (radius 62.5).
const OPTIONS: SurfaceFieldOptions = {
  gap: 44, focusRadius: 250, lineRadius: 62.5, maxOpacity: 0.26, baseOpacity: 0.05, tint: 0.22,
  rippleSpeed: 0.6, rippleWidth: 38, surfacePadding: 0, rippleBoost: 0.14, rippleGrow: 0.3, ripplePush: 6,
  cursorPush: 4, cursorPushRadius: 110, connected: true, breathe: 0.3, breatheRate: 1, still: false, wander: false,
  prefersReduced: false, focused: true, workArea: true, viewport: undefined,
};

type Driver = {
  sink: Pick<WorkerSink, "pointerMove" | "pointerDown" | "pointerUp" | "pointerOut" | "pointerCancel" | "signal" | "resize" | "recolour" | "focus" | "blur" | "visibility" | "viewportProp" | "ripple">;
  /** One vsync at page time `time`: the page's frame first (the flush), then the drawing thread's. */
  frame(time: number): void;
  log: Log;
  posts: ToFieldWorker[];
  errors: FromFieldWorker[];
};

/* The worker's clock starts about a second after the page's: `toPage` must
   undo it. A power of two, and frames 16.5ms apart, so the translation is exact
   in binary: a real worker's clock adds a rounding of about 1e-13 ms, which
   moves a dot by a few ULPs of a pixel and no rasteriser can see, but which a
   call-for-call comparison would report. */
const WORKER_LATER = 1024;

function drive(mode: "direct" | "worker", options: SurfaceFieldOptions, world: World): Driver {
  const log: Log = [];
  activeLog = log;
  const posts: ToFieldWorker[] = [];
  const errors: FromFieldWorker[] = [];
  const canvas = fakeCanvas("dots", log);
  const fabric = options.connected ? fakeCanvas("fabric", log) : null;
  const page = clockQueue();
  const colors = reader(world);
  const sceneOrigin = (root: { getBoundingClientRect(): { left: number; top: number } } | undefined | null) => {
    const b = root?.getBoundingClientRect();
    return { x: (b?.left ?? 0) - world.box.left, y: (b?.top ?? 0) - world.box.top };
  };
  if (mode === "direct") {
    const engine = startSurfaceField({
      canvas, fabric,
      box: () => world.box,
      dpr: () => 2,
      now: () => world.now,
      frame: cb => page.frame(cb),
      cancelFrame: id => page.cancelFrame(id),
      setTimer: (run, ms) => page.setTimer(run, ms, world.now),
      clearTimer: id => page.clearTimer(id),
      readColor: colors.read,
      readTintHue: colors.readHue,
      sceneOrigin: (scene: SurfaceFieldEngineScene | null) => sceneOrigin(scene?.root),
    }, options, { pending: { current: [] }, floor: { current: null } })!;
    engine.begin();
    return {
      sink: engine, log, posts, errors,
      frame(time) { world.now = time; page.runTimers(time); page.runFrames(time); },
    };
  }
  const drawing = clockQueue();
  const workerNow = () => world.now - WORKER_LATER;
  const runtime = createFieldWorkerRuntime({
    postMessage: message => { errors.push(message); },
    performance: { now: workerNow, timeOrigin: 4096 + WORKER_LATER },
    requestAnimationFrame: cb => drawing.frame(cb),
    cancelAnimationFrame: id => drawing.cancelFrame(id),
    setTimeout: (run, ms) => drawing.setTimer(run, ms, workerNow()),
    clearTimeout: id => drawing.clearTimer(id),
  });
  const sink = createWorkerSink({
    post: message => {
      posts.push(message);
      /* Everything but the canvases crosses as a structured clone would. */
      const { canvases, ...rest } = message as ToFieldWorker & { canvases?: unknown };
      const copy = structuredClone(rest) as ToFieldWorker;
      runtime.handle((canvases ? { ...copy, canvases } : copy) as ToFieldWorker);
    },
    box: () => ({ ...world.box }),
    dpr: () => 2,
    now: () => world.now,
    frame: cb => page.frame(() => cb()),
    cancelFrame: id => page.cancelFrame(id),
    colors,
    sceneOrigin: root => sceneOrigin(root),
  }, {
    canvases: [{ id: 1, canvas }, ...(fabric ? [{ id: 2, canvas: fabric }] : [])],
    transfer: [],
    canvas: 1,
    fabric: fabric ? 2 : null,
    options,
    pending: [],
    timeOrigin: 4096,
  });
  sink.begin();
  return {
    sink, log, posts, errors,
    frame(time) {
      world.now = time;
      page.runTimers(time);
      page.runFrames(time);
      drawing.runTimers(workerNow());
      drawing.runFrames(workerNow());
    },
  };
}

const pointer = (x: number, y: number, over: Partial<SurfaceFieldPointer> = {}): SurfaceFieldPointer =>
  ({ pointerId: 1, clientX: x, clientY: y, buttons: 0, button: 0, pointerType: "mouse", inRoot: true, related: true, ...over });

/* The seeded stand-in for `Math.random`, reset per run so both runs draw the same wander. */
const seed = () => {
  let state = 12345;
  vi.spyOn(Math, "random").mockImplementation(() => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648));
};

/* A mismatch is reported as where it starts, not as a diff of two very long
   lists, which is more than the test runner can print. */
const same = (worker: Log, direct: Log) => {
  const n = Math.max(worker.length, direct.length);
  for (let i = 0; i < n; i++) {
    if (worker[i] !== direct[i]) {
      const cut = (line: string | undefined) => line === undefined ? "(end)" : line.length > 300 ? `${line.slice(0, 300)}…` : line;
      return `call ${i} of ${direct.length}/${worker.length}:\n direct ${cut(direct[i])}\n worker ${cut(worker[i])}\n before ${cut(direct[i - 1])}`;
    }
  }
  return "same";
};

type Script = (d: Driver, world: World, t: { v: number }) => void;
const tick = (d: Driver, t: { v: number }, n = 1) => { for (let i = 0; i < n; i++) d.frame(t.v += 16.5); };

function both(options: SurfaceFieldOptions, script: Script) {
  const run = (mode: "direct" | "worker") => {
    seed();
    const world: World = { now: 100, box: boxAt(40, 30, 640, 420), board: { left: 60, top: 50 }, theme: LIGHT };
    const d = drive(mode, options, world);
    script(d, world, { v: 100 });
    vi.restoreAllMocks();
    return d;
  };
  const direct = run("direct");
  const worker = run("worker");
  return { direct, worker };
}

const root = (world: World) => ({ getBoundingClientRect: () => world.board });

const gesture: Script = (d, world, t) => {
  tick(d, t, 3);
  d.sink.signal({ kind: "scene", value: { root: root(world), rects: [
    { id: "a", parent: null, left: 20, top: 20, right: 220, bottom: 160 },
    { id: "b", parent: "a", left: 300, top: 120, right: 420, bottom: 300 },
  ] } as unknown as SurfaceFieldEngineScene });
  tick(d, t, 4);
  /* The hand comes in and wanders over the table. */
  for (let i = 0; i < 12; i++) { d.sink.pointerMove(pointer(200 + i * 9, 180 + i * 4)); tick(d, t); }
  /* A press, a slow start inside the slop, then a carry with footprints. */
  d.sink.pointerDown(pointer(320, 220, { buttons: 1 }));
  tick(d, t);
  d.sink.signal({ kind: "footprint", value: { pointerId: 1, rects: [{ left: 300, top: 150, right: 460, bottom: 330 }], ids: ["b"], initial: true } });
  d.sink.pointerMove(pointer(321, 221, { buttons: 1 }));
  tick(d, t);
  for (let i = 0; i < 10; i++) {
    d.sink.pointerMove(pointer(322 + i * 7, 222 + i * 3, { buttons: 1 }));
    d.sink.signal({ kind: "footprint", value: { pointerId: 1, rects: [{ left: 302 + i * 7, top: 152 + i * 3, right: 462 + i * 7, bottom: 332 + i * 3 }], ids: ["b"] } });
    tick(d, t);
  }
  d.sink.pointerUp(pointer(392, 252));
  tick(d, t, 8);
  /* A drop preview comes and goes, committed. */
  d.sink.signal({ kind: "preview", value: { rect: { left: 100, top: 300, right: 260, bottom: 400 } } });
  tick(d, t, 3);
  d.sink.signal({ kind: "preview", value: { rect: null, committed: true } });
  tick(d, t, 12);
  /* The camera pans, then zooms about a point: the floor follows and a wave goes out. */
  for (let i = 0; i < 6; i++) { d.sink.signal({ kind: "viewport", value: { x: i * 5, y: -i * 3, zoom: 1 } }); tick(d, t); }
  for (let i = 1; i <= 8; i++) { d.sink.signal({ kind: "viewport", value: { x: 30 - i * 12, y: -15 - i * 9, zoom: 1 + i * 0.08 } }); tick(d, t); }
  tick(d, t, 20);
  /* A ring from the layout above, a theme change, and the window growing. */
  d.sink.ripple(120, 90);
  tick(d, t, 5);
  world.theme = DARK;
  d.sink.recolour();
  tick(d, t, 3);
  world.box = boxAt(40, 30, 700, 460);
  d.sink.resize();
  tick(d, t, 10);
  /* The hand leaves, the window loses focus, and the light comes to rest. */
  d.sink.pointerOut(pointer(900, 900, { related: false }));
  d.sink.blur();
  tick(d, t, 200);
};

// These CPU-bound parity tests record every drawing call across hundreds of
// simulated frames on both engines. Allow contended CI runners enough wall
// time without relaxing the assertions or the default for ordinary web tests.
describe("SurfaceField on a worker draws what it draws on the page", { timeout: 60_000 }, () => {
  beforeEach(() => { vi.stubGlobal("Path2D", FakePath); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("through a whole gesture: scene, hover, press, carry, preview, pan, zoom, ring, theme, resize", () => {
    const { direct, worker } = both(OPTIONS, gesture);
    expect(worker.errors).toEqual([]);
    expect(direct.log.length).toBeGreaterThan(2000);
    expect(same(worker.log, direct.log)).toBe("same");
  });

  it("without the fabric, with the light wandering on its own", () => {
    const { direct, worker } = both({ ...OPTIONS, connected: false, wander: true, breathe: 0 }, gesture);
    expect(worker.errors).toEqual([]);
    expect(direct.log.length).toBeGreaterThan(1000);
    expect(same(worker.log, direct.log)).toBe("same");
  });

  it("as a still texture that only breathes, dozing on its timer between breaths", () => {
    const { direct, worker } = both({ ...OPTIONS, still: true, breathe: 0.6, breatheRate: 2 }, (d, world, t) => {
      tick(d, t, 120);
      d.sink.signal({ kind: "viewport", value: { x: 11, y: 7, zoom: 1.3 } });
      tick(d, t, 60);
      world.theme = DARK;
      d.sink.recolour();
      tick(d, t, 60);
    });
    expect(worker.errors).toEqual([]);
    expect(direct.log.some(line => line.startsWith("dots.arc"))).toBe(true);
    expect(same(worker.log, direct.log)).toBe("same");
  });

  it("under reduced motion: one frame, and a camera or a theme drawn at once", () => {
    const { direct, worker } = both({ ...OPTIONS, prefersReduced: true }, (d, world, t) => {
      tick(d, t, 2);
      d.sink.signal({ kind: "viewport", value: { x: 40, y: 10, zoom: 0.8 } });
      tick(d, t, 2);
      world.theme = DARK;
      d.sink.recolour();
      tick(d, t, 2);
    });
    expect(worker.errors).toEqual([]);
    expect(direct.log.length).toBeGreaterThan(100);
    expect(same(worker.log, direct.log)).toBe("same");
  });

  it("posts one batch per frame, with a burst of hover moves merged into one", () => {
    const { direct, worker } = both({ ...OPTIONS, breathe: 0 }, (d, _world, t) => {
      tick(d, t, 2);
      for (let i = 0; i < 5; i++) d.sink.pointerMove(pointer(100 + i * 10, 100 + i * 5));
      tick(d, t, 40);
    });
    const batches = worker.posts.filter(post => post.type === "batch");
    const hover = batches.find(post => post.type === "batch" && post.items.some(item => item.k === "move"));
    expect(hover && hover.type === "batch" && hover.items.filter(item => item.k === "move").length).toBe(1);
    expect(same(worker.log, direct.log)).toBe("same");
  });

  it("never merges the moves that decide a press: inside the slop, or a release heard as a move", () => {
    const { direct, worker } = both({ ...OPTIONS, breathe: 0 }, (d, _world, t) => {
      tick(d, t, 2);
      d.sink.pointerDown(pointer(200, 200, { buttons: 1 }));
      /* 1px, then 9px, then back to 2px: the carry is decided by the middle one. */
      d.sink.pointerMove(pointer(201, 200, { buttons: 1 }));
      d.sink.pointerMove(pointer(209, 200, { buttons: 1 }));
      d.sink.pointerMove(pointer(202, 200, { buttons: 1 }));
      tick(d, t, 3);
      /* A release nobody heard: two moves with no buttons. */
      d.sink.pointerMove(pointer(230, 210));
      d.sink.pointerMove(pointer(260, 220));
      tick(d, t, 60);
    });
    const moves = worker.posts.flatMap(post => post.type === "batch" ? post.items.filter(item => item.k === "move") : []);
    expect(moves.length).toBeGreaterThanOrEqual(4);
    expect(same(worker.log, direct.log)).toBe("same");
  });

  /* The trim (`engine.ts#trimIfIdle`) writes each width one pixel wide and
     back. Those writes are how the log shows it. */
  const trims = (log: Log, name: string) => log.filter(line => line === `${name}.width=1401`).length;
  const resting = (d: Driver, world: World, t: { v: number }) => {
    gesture(d, world, t);
    tick(d, t, 300);
  };

  it("gives a resting field's buffers back once and presents the kept picture into the new ones, the same on both threads", () => {
    /* NOT ONE PIXEL MOVES AND NOTHING IS DRAWN AGAIN. The picture lives in
       the masters, which the trim does not touch: the visible canvases are
       reset and the masters copied back into them 1:1. */
    vi.stubGlobal("OffscreenCanvas", FakeMaster);
    const { direct, worker } = both({ ...OPTIONS, breathe: 0 }, resting);
    expect(worker.errors).toEqual([]);
    expect(trims(direct.log, "dots")).toBe(1);
    expect(trims(direct.log, "fabric")).toBe(1);
    const at = direct.log.indexOf("dots.width=1401");
    expect(direct.log.slice(at)).toEqual([
      "dots.width=1401", "dots.width=1400", "fabric.width=1401", "fabric.width=1400",
      "dotsMaster.isContextLost()", 'dots.globalCompositeOperation="copy"', "dots.drawImage(dotsMaster,0,0)",
      "fabricMaster.isContextLost()", 'fabric.globalCompositeOperation="copy"', "fabric.drawImage(fabricMaster,0,0)",
    ]);
    expect(same(worker.log, direct.log)).toBe("same");
  });

  it("repaints from scratch after a trim where there is no master to present", () => {
    const { direct, worker } = both({ ...OPTIONS, breathe: 0 }, resting);
    expect(trims(direct.log, "dots")).toBe(1);
    expect(direct.log.some(line => line.includes("Master"))).toBe(false);
    const at = direct.log.indexOf("dots.width=1401");
    expect(direct.log.slice(at, at + 6)).toEqual([
      "dots.width=1401", "dots.width=1400", "fabric.width=1401", "fabric.width=1400",
      "dots.setTransform(2,0,0,2,0,0)", "fabric.setTransform(2,0,0,2,0,0)",
    ]);
    expect(direct.log.slice(at).some(line => line.startsWith("dots.clearRect(0,0,700,"))).toBe(true);
    expect(same(worker.log, direct.log)).toBe("same");
  });

  it("with masters, draws only on them and presents every painted frame once, after its drawing", () => {
    vi.stubGlobal("OffscreenCanvas", FakeMaster);
    const { direct, worker } = both(OPTIONS, gesture);
    expect(worker.errors).toEqual([]);
    expect(same(worker.log, direct.log)).toBe("same");
    /* The visible canvases are sized, asked whether they are lost, and shown
       into, and nothing else. */
    const visible = direct.log.filter(line => /^(dots|fabric)\./.test(line));
    const shows = /^(dots|fabric)\.(width|height)=\d+$|^(dots|fabric)\.isContextLost\(\)$|^(dots|fabric)\.globalCompositeOperation="copy"$|^dots\.drawImage\(dotsMaster,0,0\)$|^fabric\.drawImage\(fabricMaster,0,0\)$/;
    expect(visible.filter(line => !shows.test(line))).toEqual([]);
    /* Every run of drawing on a master is followed by one present of both
       layers, and a present never comes without drawing before it. A layer
       is shown only after its master is found not lost: a lost master holds
       no picture to show. */
    const draws = (line: string) => /^(dots|fabric)Master\.(?!width=|height=|isContextLost\(\))/.test(line);
    const present = [
      "dotsMaster.isContextLost()", 'dots.globalCompositeOperation="copy"', "dots.drawImage(dotsMaster,0,0)",
      "fabricMaster.isContextLost()", 'fabric.globalCompositeOperation="copy"', "fabric.drawImage(fabricMaster,0,0)",
    ];
    let drew = false, presents = 0;
    for (let i = 0; i < direct.log.length; i++) {
      const line = direct.log[i];
      if (draws(line)) drew = true;
      else if (line === present[1]) {
        expect(direct.log.slice(i - 1, i + 5)).toEqual(present);
        expect(drew).toBe(true);
        drew = false;
        presents++;
      }
    }
    expect(drew).toBe(false);
    expect(presents).toBeGreaterThan(100);
  });

  it("never trims a field whose breath keeps it painting", () => {
    const { direct, worker } = both(OPTIONS, (d, world, t) => {
      gesture(d, world, t);
      tick(d, t, 600);
    });
    expect(trims(direct.log, "dots")).toBe(0);
    expect(same(worker.log, direct.log)).toBe("same");
  });

  it("reports a failure instead of drawing half a frame", () => {
    const errors: FromFieldWorker[] = [];
    const runtime = createFieldWorkerRuntime({
      postMessage: message => errors.push(message),
      performance: { now: () => 0, timeOrigin: 0 },
      setTimeout: () => 0,
      clearTimeout: () => {},
    });
    runtime.handle({ type: "start", canvases: [], canvas: 9, fabric: null, options: OPTIONS, pending: [], box: boxAt(0, 0, 10, 10), dpr: 1, colors: null, hue: null, origin: null, timeOrigin: 0, t: 0 });
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe("error");
  });
});
