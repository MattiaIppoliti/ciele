import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startSurfaceField, type SurfaceFieldOptions, type SurfaceFieldRgb } from "./engine";

/* ═══ WHAT A CANVAS HOLDS, AS THE LIST OF WHAT WAS DRAWN ON IT ═══════════
   .
   Node has no pixels, so a canvas here holds its picture as the calls that
   made it: every call and every property written since the last reset, in
   order. A reset (a width or height written) empties it, and a `copy` of
   another canvas replaces it with that canvas's list, which is what `copy`
   does to pixels. Two canvases with the same list hold the same picture.
   `lose()` empties a canvas behind the engine's back, the way a failed
   copy-on-write in the compositor hands back a buffer that starts black. */

type Picture = string[];
type Fake = {
  width: number;
  height: number;
  picture: Picture;
  lost: boolean;
  lose(): void;
  fire(type: string): void;
  getContext(kind: "2d"): unknown;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

const fmt = (value: unknown): string => typeof value === "string" ? JSON.stringify(value) : String(value);

const fakeCanvas = (w = 300, h = 150): Fake => {
  const listeners = new Map<string, Set<() => void>>();
  let width = w, height = h;
  let composite = "source-over";
  const canvas: Fake = {
    get width() { return width; },
    set width(value) { width = value; canvas.picture = []; composite = "source-over"; },
    get height() { return height; },
    set height(value) { height = value; canvas.picture = []; composite = "source-over"; },
    picture: [],
    lost: false,
    lose() { canvas.picture = ["LOST"]; },
    fire(type) { for (const listener of listeners.get(type) ?? []) listener(); },
    getContext: () => ctx,
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
  };
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_, key) => {
      if (key === "isContextLost") return () => canvas.lost;
      if (key === "drawImage") return (source: Fake, x: number, y: number) => {
        if (composite === "copy" && x === 0 && y === 0 && source.width === width && source.height === height) canvas.picture = [...source.picture];
        else canvas.picture.push(`drawImage(${composite})`);
      };
      return typeof key === "string" ? (...args: unknown[]) => { canvas.picture.push(`${key}(${args.map(fmt).join(",")})`); } : undefined;
    },
    set: (_, key, value) => {
      if (key === "globalCompositeOperation") composite = String(value);
      canvas.picture.push(`${String(key)}=${fmt(value)}`);
      return true;
    },
  });
  return canvas;
};

/* The engine's masters, kept where the test can look at them. */
let masters: Fake[] = [];
class FakeOffscreen {
  constructor(width: number, height: number) {
    const canvas = fakeCanvas(width, height);
    masters.push(canvas);
    return canvas as unknown as FakeOffscreen;
  }
}
class FakePath {
  constructor() {
    return new Proxy(this, { get: (target, key) => key in target ? (target as unknown as Record<string | symbol, unknown>)[key] : () => {} });
  }
}

const OPTIONS: SurfaceFieldOptions = {
  gap: 22, focusRadius: 250, lineRadius: 62.5, maxOpacity: 0.26, baseOpacity: 0.05, tint: 0.22,
  rippleSpeed: 0.6, rippleWidth: 38, surfacePadding: 0, rippleBoost: 0.14, rippleGrow: 0.3, ripplePush: 6,
  cursorPush: 0, cursorPushRadius: 110, connected: true, breathe: 0, breatheRate: 1, still: false, wander: false,
  prefersReduced: false, focused: true, workArea: false, viewport: undefined,
};

function field() {
  masters = [];
  const dots = fakeCanvas(), fabric = fakeCanvas();
  let now = 1000;
  const frames = new Map<number, (time: number) => void>();
  let next = 1;
  const engine = startSurfaceField({
    canvas: dots, fabric,
    box: () => ({ left: 0, top: 0, right: 480, bottom: 320, width: 480, height: 320 }),
    dpr: () => 2,
    now: () => now,
    frame: callback => { frames.set(next, callback); return next++; },
    cancelFrame: id => { frames.delete(id); },
    setTimer: () => 0,
    clearTimer: () => {},
    readColor: () => ({ fg: [23, 23, 23] as SurfaceFieldRgb, primary: [230, 120, 50] as SurfaceFieldRgb }),
    readTintHue: () => null,
    sceneOrigin: () => ({ x: 0, y: 0 }),
  }, OPTIONS, { pending: { current: [] }, floor: { current: null } })!;
  engine.begin();
  const tick = () => {
    now += 16;
    const due = [...frames.values()];
    frames.clear();
    for (const run of due) run(now);
  };
  const move = (x: number, y: number) => engine.pointerMove({ pointerId: 1, clientX: x, clientY: y, buttons: 0, button: 0, pointerType: "mouse", inRoot: true, related: false });
  return { dots, fabric, masters: [...masters], engine, tick, move };
}

/* The light is sent across the field and caught mid-flight, when every
   frame paints: the frames before the last one are the same in every run. */
const flight = (f: ReturnType<typeof field>, lose?: () => void) => {
  for (let i = 0; i < 4; i++) f.tick();
  f.move(80, 60);
  for (let i = 0; i < 30; i++) f.tick();
  f.move(400, 260);
  for (let i = 0; i < 5; i++) f.tick();
  lose?.();
  f.tick();
};

describe("a visible canvas that loses its picture", () => {
  beforeEach(() => { vi.stubGlobal("Path2D", FakePath); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("is given the whole picture back by the next painted frame", () => {
    vi.stubGlobal("OffscreenCanvas", FakeOffscreen);
    const kept = field();
    flight(kept);
    const wiped = field();
    flight(wiped, () => { wiped.dots.lose(); wiped.fabric.lose(); });
    expect(wiped.masters).toHaveLength(2);
    for (const layer of ["dots", "fabric"] as const) {
      expect(wiped[layer].picture).not.toContain("LOST");
      expect(wiped[layer].picture).toEqual(kept[layer].picture);
      expect(wiped[layer].picture.length).toBeGreaterThan(100);
    }
    expect(wiped.dots.picture).toEqual(wiped.masters[0].picture);
    expect(wiped.fabric.picture).toEqual(wiped.masters[1].picture);
  });

  it("is built on where there is no master, which is the fault the master exists for", () => {
    const wiped = field();
    flight(wiped, () => { wiped.dots.lose(); });
    expect(wiped.dots.picture[0]).toBe("LOST");
  });

  it("is repaired by a present, not a repaint, when its context comes back", () => {
    vi.stubGlobal("OffscreenCanvas", FakeOffscreen);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = field();
    flight(f);
    /* Let the light arrive and the loop go to sleep: nothing paints now. */
    for (let i = 0; i < 400; i++) f.tick();
    const kept = [...f.masters[0].picture];
    f.dots.lost = true;
    f.dots.lose();
    f.dots.fire("contextlost");
    f.tick(); // still lost: nothing to repair onto
    f.dots.lost = false;
    f.dots.fire("contextrestored");
    expect(f.dots.picture).toEqual(kept);
    /* The master was not drawn again, only shown again. */
    expect(f.masters[0].picture).toEqual(kept);
  });

  it("is not overwritten by a master that lost its own context", () => {
    vi.stubGlobal("OffscreenCanvas", FakeOffscreen);
    const f = field();
    flight(f);
    const shown = [...f.dots.picture];
    f.masters[0].lost = true;
    f.masters[0].lose();
    f.move(120, 200);
    for (let i = 0; i < 5; i++) f.tick();
    expect(f.dots.picture).not.toContain("LOST");
    expect(f.dots.picture).toEqual(shown);
  });
});

describe("a disposed field", () => {
  beforeEach(() => { vi.stubGlobal("Path2D", FakePath); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("gives its masters' backings back at once", () => {
    vi.stubGlobal("OffscreenCanvas", FakeOffscreen);
    const f = field();
    flight(f);
    expect(f.masters.every(m => m.width > 0 && m.height > 0)).toBe(true);
    f.engine.dispose();
    for (const master of f.masters) expect([master.width, master.height]).toEqual([0, 0]);
    /* And leaves the canvases on screen to their owner. */
    expect(f.dots.width).toBeGreaterThan(0);
  });
});
