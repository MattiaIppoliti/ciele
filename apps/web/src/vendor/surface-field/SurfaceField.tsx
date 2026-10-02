
import * as React from "react";
import type { SurfaceFieldController } from "./controller";
import { attachSurfaceFieldHost, createColorReader, mainThreadEnv, type SurfaceFieldSink } from "./dom";
import { startSurfaceField, surfaceFieldLoop, type SurfaceFieldEngine, type SurfaceFieldFloor, type SurfaceFieldOptions } from "./engine";
import type { SurfaceFieldViewport } from "./viewport";
import { canTransfer, createWorkerLane, startWorkerField, type WorkerLane } from "./worker-client";

/**
 * SurfaceField: a decorative grid of dots lit by a soft radial "spotlight" that
 * drifts on its own and snaps toward the cursor while it's over the band.
 * Dots brighten and grow toward the focal centre and fade to nothing outside
 * its radius, like a moving radial gradient. A click drops a ripple: an
 * expanding ring that lifts and gently nudges outward the dots it passes, like
 * a stone on water. Purely ambient: `aria-hidden`, `pointer-events-none`,
 * theme-aware (reads inherited color + the `tintVar` token), paused when the tab
 * is hidden, and rendered once (centred, no motion) under reduced-motion.
 *
 * `tintVar` lets a surface pick the light colour.
 */
export function SurfaceField({
  className,
  style,
  gap = 22,
  focusRadius = 250,
  lineRadius = focusRadius * 0.25,
  maxOpacity = 0.26,
  baseOpacity = 0.05,
  tint = 0.22,
  tintVar = "--surface-field-tint",
  tintHueVar,
  tintHue = 293,
  rippleSpeed = 0.6,
  rippleWidth = 38,
  surfacePadding = 0,
  rippleBoost = 0.14,
  rippleGrow = 0.3,
  ripplePush = 6,
  cursorPush = 0,
  cursorPushRadius = 110,
  ripple = null,
  interactionRoot,
  controller,
  containerRef,
  connected = false,
  breathe = 1,
  breatheRate = 1,
  still = false,
  wander = true,
  viewport,
  worker,
}: {
  className?: string;
  /** For the mask that keeps the band from ending in a straight line. */
  style?: React.CSSProperties;
  /** Grid spacing in px. */
  gap?: number;
  /** Radius of the moving spotlight in px. */
  focusRadius?: number;
  /** Independent reach of connected lines, in CSS pixels. */
  lineRadius?: number;
  /** Dot opacity at the focal centre. */
  maxOpacity?: number;
  /** Faint opacity far from the focal. */
  baseOpacity?: number;
  /** Max blend toward the tint colour at the focal centre. 0 disables. */
  tint?: number;
  /** CSS custom property to read for the warm light colour (e.g. "--ai"). */
  tintVar?: string;
  /**
   * A registered `<angle>` property the warm light's HUE should follow, e.g.
   * `--brand-hue`. When it is set, `tintVar` is ignored and the light is
   * `oklch(0.72 0.19 tintHue + <that angle>)` instead , the spectrum's own
   * palette, so an ambient wash and a spectrum stroke in the same room are
   * literally the same colour at every instant.
   *
   * IT IS READ FROM THE CANVAS AND NOT FROM `:root`, unlike `tintVar`. That is
   * the entire mechanism: the property inherits, so whichever ancestor is
   * animating it reaches this element, and a field inside a lit room moves
   * while an identical field outside one does not.
   */
  tintHueVar?: string;
  /** The hue it rests at, in degrees, before that angle is added. */
  tintHue?: number;
  /** Speed of a click ripple's crest, in px per ms. */
  rippleSpeed?: number;
  /** Thickness of the ripple's crest in px (the Gaussian band that lights up). */
  rippleWidth?: number;
  /** Signed CSS px adjustment to the empty fade outside scene and carried surfaces. Zero keeps the existing rippleWidth-sized fade. */
  surfacePadding?: number;
  /** Max extra opacity a passing crest adds , kept under the ambient peak so the wave whispers. 0 disables the lift. */
  rippleBoost?: number;
  /** Max extra dot radius (px) a passing crest adds , kept under the spotlight's own growth. 0 keeps crest dots their base size. */
  rippleGrow?: number;
  /** Max outward displacement of a dot at the crest, in px. 0 keeps the grid rigid. */
  ripplePush?: number;
  /** Peak outward displacement of the resting pointer's local field, in CSS px. */
  cursorPush?: number;
  /** Reach of the pointer's local displacement; its light keeps focusRadius. */
  cursorPushRadius?: number;
  /**
   * ═══════════════════════════════════════════════════════════════════════
   *  A RING WITHOUT A CLICK, so something happening in the layout above can
   *  be felt in the field below it.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * The field already drops a ripple where somebody presses, and that is a
   * person touching the surface. This is the other direction: the claim
   * stage's code chip comes to rest on the plate, and the ring goes out from
   * where it landed. The material reacts to the content rather than to the
   * cursor, which is the difference between an effect and an event.
   *
   * `x` and `y` are in the FIELD'S OWN BOX, in CSS pixels, because that is
   * the only frame both sides can agree on without one of them measuring the
   * other. The caller has the element and the element's rect; this has the
   * canvas.
   *
   * `at` is what makes it fire: a new value, any value, drops one ring. It is
   * an identity and not a timestamp on purpose, so a caller may use a counter
   * and never has to think about clock skew or about the same point being hit
   * twice in a row. `null` never fires, which is the default and is what every
   * existing use of this component gets.
   */
  ripple?: { x: number; y: number; at: number } | null;
  /** When set, a work-area press holds its ripple until release. */
  interactionRoot?: React.RefObject<HTMLElement | null>;
  /** Instance-owned input channel for scene and gesture geometry. */
  controller?: SurfaceFieldController;
  /** The field's outer element, for host layout or theme observation. */
  containerRef?: React.RefObject<HTMLDivElement | null>;
  /** Draw a fine orthogonal fabric between the displaced dots. */
  connected?: boolean;
  /**
   * ═══════════════════════════════════════════════════════════════════════
   *  A FEW DOTS THAT ARE NOT OBEYING THE LIGHT.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Every dot in this field is a pure function of its distance from the
   * focal. That is why the grid reads as perfect and slightly dead: nothing
   * in it belongs to ITSELF. This gives a small minority of the dots one
   * private property , a slow breath that takes them most of the way down to
   * nothing and back , so the field has grain that the light does not
   * explain.
   *
   * THEY DIM, THEY NEVER BRIGHTEN, and that is the whole reason this can be
   * on by default. A dot that lights up on its own competes with the focal,
   * which is the one thing this component exists to say; a dot that steps out
   * for two seconds is just material that is not uniform.
   *
   * WHICH dots is not random per frame but hashed from the cell's own
   * coordinates, so dot 47 breathes at the same rate for the life of the
   * mount and the field has a character instead of a flicker. The hash is
   * taken once per resize and nothing is allocated per frame.
   *
   * THE VALUE IS THE SHARE OF DOTS THAT BREATHE, and 0 is off. It is one
   * number and not a flag plus a density because the two would never be set
   * independently: every caller that turns this on immediately wants to say
   * how much of it, and a flag that only decides whether a second number is
   * read is a flag the reader has to hold in their head.
   *
   * See BREATH_* below for the periods and the depth, and `renderBreath` for
   * why this does not cost the field its sleep.
   */
  breathe?: number;
  /**
   * HOW FAST THE WHOLE FIELD BLINKS, as a multiplier on the tuned periods: 2
   * is twice as fast, 0.5 is half. Every dot keeps its own period and its own
   * phase , this scales the spread, it does not collapse it.
   *
   * It is a SEPARATE DIAL FROM `breathe` because the two failures it fixes are
   * not the same failure and the codebase learned that the hard way. Density
   * answers "there are not enough of them"; rate answers "I cannot see the
   * ones there are", and for a long stretch here the second was mistaken for
   * the first , the density went up four times, to every dot in the field, and
   * the canvas still looked static. See BREATH_MIN.
   */
  breatheRate?: number;
  /**
   * ═══════════════════════════════════════════════════════════════════════
   *  NO LIGHT AND NO HAND: A FIELD THAT IS JUST A FIELD.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * The focal spotlight is what this component is FOR on an active surface.
   * Behind a hero section it says nothing, and it competes: there is already
   * a light in that room, it already follows the hand, and a second one
   * doing the same thing a layer behind reads as the page having two
   * cursors.
   *
   * So this turns the field into a texture. Every dot at `maxOpacity`, no
   * drift, no chase, no listeners and ONE frame for the life of the mount,
   * which also means the compositor is untouched by it forever after. What
   * shapes it then is whatever mask the caller puts on it, which is the
   * honest division: the field draws dots, the room decides where they stop.
   *
   * `baseOpacity` AND `focusRadius` ARE UNUSED WHEN THIS IS SET, and they
   * are left alone rather than made to mean something else. A prop that
   * quietly changes what two other props mean is how a component becomes
   * unreadable; this one simply says the gradient is not happening.
   */
  still?: boolean;
  /**
   * ═══════════════════════════════════════════════════════════════════════
   *  THE LIGHT GOES WHERE THE HAND IS, AND NOWHERE ON ITS OWN.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * The wander re-aims the light every 2.6s while the window has focus, and
   * the focal eases at 0.02 , it is re-aimed before it can arrive, so a
   * focused window with a wandering light NEVER SLEEPS: a large work area
   * measured it at a tenth of the renderer's main thread, for ever, with
   * nothing on the table moving. A surface whose whole job is to sit behind
   * other work cannot afford that, so `false` keeps the chase and the rings
   * and drops the drift: the light follows the hand, arrives, and the loop
   * goes down until the hand moves again. With `breathe` at 0 as well, a
   * table nobody touches draws nothing at all.
   */
  wander?: boolean;
  /**
   * WHERE THE HOST'S CAMERA IS, so the grid is the floor its nodes stand on.
   * React Flow's own meaning: world (wx, wy) is drawn at (wx * zoom + x,
   * wy * zoom + y) CSS px from the field root. The GRID pans 1:1 with it and
   * scales by a compressed `clamp(zoom ^ 0.4, 0.7, 1.6)`, a floor below the
   * nodes; a zoom sends a soft ring out from where it is anchored. The light,
   * the rings, the scene and the footprints stay in screen pixels.
   * `controller.setViewport` is the per-frame path and,
   * once used, wins over this prop. Default `{ x: 0, y: 0, zoom: 1 }`.
   */
  viewport?: SurfaceFieldViewport;
  /**
   * ═══════════════════════════════════════════════════════════════════════
   *  DRAW OFF THE MAIN THREAD.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * A factory for a module worker running the package's worker entry,
   * `surface-field/worker`. The field then hands its canvases to that worker
   * as OffscreenCanvases and draws there; this thread keeps only the
   * listeners, one `getBoundingClientRect` per pointer event and one
   * `postMessage` per frame.
   *
   * IT IS A FACTORY BECAUSE ONLY THE HOST'S BUNDLER CAN BUILD IT: a worker
   * URL has to be written as `new Worker(new URL("…", import.meta.url))` in
   * code the bundler sees. With Vite, for example:
   *
   *   import FieldWorker from "surface-field/worker?worker";
   *   <SurfaceField worker={() => new FieldWorker()} />
   *
   * THE PICTURE IS THE SAME, because the drawing is the same code
   * (`engine.ts`). Where OffscreenCanvas or workers are missing, the factory
   * throws, or the worker fails later, the field draws on the main thread,
   * as it does without this prop. Read once per mount for whether it is
   * set; a new function identity does not restart anything.
   */
  worker?: () => Worker;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const fabricRef = React.useRef<HTMLCanvasElement>(null);
  /* Rings asked for by the layout above, waiting for the next painted frame.
     See the `ripple` prop and `drainPending` in `engine.ts`. */
  const pending = React.useRef<{ x: number; y: number }[]>([]);
  const lastRipple = React.useRef<number | null>(null);
  /* The loop SLEEPS once the light has arrived (see `settled`), so a ring
     asked for by the layout has to be able to wake it. The effect that owns
     the engine hangs its `ripple` here; nothing else may call it. */
  const rippleRef = React.useRef<((x: number, y: number) => void) | null>(null);
  /* THE CAMERA IS NOT A DEPENDENCY OF THE CANVAS. Re-running the effect below
     for a pan would tear down the observers, the listeners and the loop sixty
     times a second. The prop is kept in a ref for the effect's first frame
     and forwarded to it through `viewportRef` afterwards; declared before
     that effect so on mount the ref is filled before it is read. */
  const viewportProp = React.useRef(viewport);
  /* THE FLOOR OUTLIVES THE CANVAS. It is carried from camera to camera (see
     `advanceLattice`), so it is not a function of the camera alone: rebuilt
     from scratch, it would jump every time a prop re-runs the effect below.
     Kept per `gap`, since a different gap is a different floor. */
  const floorRef = React.useRef<SurfaceFieldFloor | null>(null);
  const viewportRef = React.useRef<((viewport: SurfaceFieldViewport | undefined) => void) | null>(null);
  /* THE WORKER, when there is one: one per mount, see `WorkerLane`. `failed`
     is for the life of the mount, and `epoch` keys the canvases, because a
     canvas that was handed to a worker that then failed can never be drawn on
     by this page again: the fallback needs NEW elements. */
  const workerFactory = React.useRef(worker);
  React.useLayoutEffect(() => {
    workerFactory.current = worker;
  }, [worker]);
  const lane = React.useRef<WorkerLane | null>(null);
  const failed = React.useRef(false);
  /* Every canvas this mount ever handed over, whichever lane took it. */
  const handedRef = React.useRef(new WeakSet<HTMLCanvasElement>());
  const [epoch, setEpoch] = React.useState(0);
  const wantsWorker = Boolean(worker);
  React.useEffect(() => {
    viewportProp.current = viewport;
    viewportRef.current?.(viewport);
  }, [viewport]);

  /**
   * ONE RING PER NEW `at`, AND NEVER ONE PER RENDER.
   *
   * The prop is an object, so a parent that builds it inline hands us a new
   * identity every render; keyed on `at` instead, a re-render for any other
   * reason cannot drop a second ring on top of the first. The effect only
   * queues: the loop decides when, because it is the thing that knows whether
   * anything is being painted.
   */
  React.useEffect(() => {
    if (!ripple) return;
    if (lastRipple.current === ripple.at) return;
    lastRipple.current = ripple.at;
    if (rippleRef.current) rippleRef.current(ripple.x, ripple.y);
    else pending.current.push({ x: ripple.x, y: ripple.y });
  }, [ripple]);

  /* The lane dies with the component and not with an effect run. Deferred, so
     a strict-mode remount, which runs every cleanup and then every setup in
     the same task, takes the living worker back instead of a dead canvas. */
  React.useEffect(() => () => {
    const current = lane.current;
    if (!current) return;
    current.kill = setTimeout(() => {
      current.worker.terminate();
      if (lane.current === current) lane.current = null;
    }, 0);
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fabric = connected ? fabricRef.current : null;
    const options: SurfaceFieldOptions = {
      gap, focusRadius, lineRadius, maxOpacity, baseOpacity, tint, tintHueVar,
      rippleSpeed, rippleWidth, surfacePadding, rippleBoost, rippleGrow, ripplePush,
      cursorPush, cursorPushRadius, connected, breathe, breatheRate, still, wander,
      prefersReduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      focused: typeof document !== "undefined" ? document.hasFocus() : true,
      workArea: Boolean(interactionRoot),
      viewport: viewportProp.current,
    };
    const flags = surfaceFieldLoop(options);
    const colors = createColorReader(canvas, tintVar, tintHueVar, tintHue);

    /* ═══ WHICH THREAD DRAWS ═════════════════════════════════════════════
       .
       The worker when the host asked for one, this page can hand a canvas
       over, and no worker has failed this mount; the page itself otherwise,
       which is the path every field had before the worker existed. A canvas
       already handed over MUST stay with its worker; one whose worker failed
       is waiting for the remount `epoch` asked for, and draws nothing until
       then. */
    const handed = handedRef.current;
    const stuck = handed.has(canvas) || (fabric !== null && handed.has(fabric));
    if (stuck && (failed.current || !lane.current)) return;
    let sink: SurfaceFieldSink & Pick<SurfaceFieldEngine, "begin" | "viewportProp" | "ripple" | "dispose"> | null = null;
    const factory = workerFactory.current;
    if (stuck || (!failed.current && factory && canTransfer(canvas))) {
      const queued = pending.current;
      pending.current = [];
      try {
        if (!lane.current) lane.current = createWorkerLane(factory!);
        const current = lane.current;
        if (current.kill) { clearTimeout(current.kill); current.kill = null; }
        current.onFail = reason => {
          fellBack(reason);
          failed.current = true;
          current.onFail = null;
          current.worker.terminate();
          if (lane.current === current) lane.current = null;
          setEpoch(value => value + 1);
        };
        sink = startWorkerField(current, canvas, fabric, options, colors, queued, handed);
      } catch (error) {
        fellBack(error instanceof Error ? error.message : String(error));
        pending.current = queued.concat(pending.current);
        /* Nothing handed over: draw here, for the life of the mount. Something
           handed over: only new canvases can be drawn on, which the lane's
           failure path asks for. */
        if (handed.has(canvas) || (fabric !== null && handed.has(fabric))) {
          if (lane.current?.onFail) lane.current.onFail("start failed");
          else { failed.current = true; setEpoch(value => value + 1); }
          return;
        }
        failed.current = true;
        lane.current?.worker.terminate();
        lane.current = null;
        sink = null;
      }
    }
    if (!sink && factory && !failed.current && !stuck) fellBack("no OffscreenCanvas or Worker here");
    if (!sink) {
      const engine = startSurfaceField(mainThreadEnv(canvas, fabric, colors), options, { pending, floor: floorRef });
      if (!engine) return;
      sink = engine;
    }
    const field = sink;
    const detach = attachSurfaceFieldHost(canvas, field, flags, { interactionRoot, controller, tintHueVar });
    viewportRef.current = next => field.viewportProp(next);
    rippleRef.current = (x, y) => field.ripple(x, y);
    field.begin();

    return () => {
      rippleRef.current = null;
      viewportRef.current = null;
      field.dispose();
      detach();
      if (lane.current) lane.current.onFail = null;
    };
  }, [
    gap,
    focusRadius,
    lineRadius,
    maxOpacity,
    baseOpacity,
    tint,
    tintVar,
    tintHueVar,
    tintHue,
    rippleSpeed,
    rippleWidth,
    surfacePadding,
    rippleBoost,
    rippleGrow,
    ripplePush,
    cursorPush,
    cursorPushRadius,
    interactionRoot,
    controller,
    connected,
    breathe,
    breatheRate,
    still,
    wander,
    wantsWorker,
    epoch,
  ]);

  return (
    <div
      ref={containerRef}
      aria-hidden
      style={{ ...style, pointerEvents: "none", overflow: "hidden" }}
      className={className}
    >
      {connected ? <div style={{ display: "grid", gridTemplate: "minmax(0, 1fr) / minmax(0, 1fr)", width: "100%", height: "100%" }}>
        <canvas key={`fabric-${epoch}`} ref={fabricRef} style={{ gridArea: "1 / 1", width: "100%", height: "100%", minWidth: 0, minHeight: 0, color: "inherit" }} />
        <canvas key={`dots-${epoch}`} ref={canvasRef} style={{ gridArea: "1 / 1", width: "100%", height: "100%", minWidth: 0, minHeight: 0, color: "inherit" }} />
      </div> : <canvas key={`dots-${epoch}`} ref={canvasRef} style={{ width: "100%", height: "100%", color: "inherit" }} />}
    </div>
  );
}

export type SurfaceFieldProps = React.ComponentProps<typeof SurfaceField>;

/* A FALLBACK IS NOT A SECOND SETTING, so it is said out loud: a host that asked
   for a worker and got the main thread is drawing on the thread it was trying
   to keep free, and that should be findable without a profiler. */
function fellBack(reason: string) {
  console.warn(`surface-field: drawing on the main thread, the worker is unavailable (${reason})`);
}
