
import * as React from "react";
import { subscribeSurfaceField, type SurfaceFieldController, type SurfaceFieldFootprint, type SurfaceFieldPreview, type SurfaceFieldScene } from "./controller";
import { advanceLattice, normalizeViewport, pickZoomAnchor, sameLattice, sameViewport, seedLattice, zoomFixedPoint, type SurfaceFieldLattice, type SurfaceFieldViewport } from "./viewport";

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
   * Behind the home hero it says nothing, and it competes: there is already
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
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const fabricRef = React.useRef<HTMLCanvasElement>(null);
  /* Rings asked for by the layout above, waiting for the next painted frame.
     See the `ripple` prop and `drainPending` inside the effect. */
  const pending = React.useRef<{ x: number; y: number }[]>([]);
  const lastRipple = React.useRef<number | null>(null);
  /* The loop below SLEEPS once the light has arrived (see `settled`), so a ring
     asked for by the layout has to be able to wake it. The effect that owns the
     loop hangs its `wake` here; nothing else may call it. */
  const wakeRef = React.useRef<(() => void) | null>(null);
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
  const floorRef = React.useRef<{ gap: number; lattice: SurfaceFieldLattice; view: SurfaceFieldViewport } | null>(null);
  const viewportRef = React.useRef<((viewport: SurfaceFieldViewport | undefined) => void) | null>(null);
  React.useEffect(() => {
    viewportProp.current = viewport;
    viewportRef.current?.(viewport);
  }, [viewport?.x, viewport?.y, viewport?.zoom]);

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
    pending.current.push({ x: ripple.x, y: ripple.y });
    wakeRef.current?.();
  }, [ripple]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const fabric = connected ? fabricRef.current : null;
    const fabricCtx = fabric?.getContext("2d") ?? null;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    /* ═══ THREE STATES, NOT TWO, SINCE THE FIELD LEARNED TO BREATHE ══════
       .
       `animating` is THE LIGHT: the focal, the drift, the chase, the rings and
       the four listeners that feed them. Reduced motion turns it off because
       it is motion somebody asked not to see; `still` turns it off because the
       field is being used as a texture and a second cursor a layer down is
       the thing that prop exists to stop.
       .
       THE BREATH IS NOT THE LIGHT, and tying the two together was wrong. A
       texture is exactly where a surface most wants to be alive , nothing else
       in it moves, so it is the one place where grain is the whole point , and
       `still` was switching it off purely because it happened to share a
       variable. It does not share one any more: `still` keeps its dead focal
       and gets its breath, and `looping` is what actually decides whether
       there is a frame loop at all.
       .
       REDUCED MOTION REMAINS THE ONE FULL STOP. A dot fading in and out IS
       motion, and it is the flickering kind that setting exists for. */
    const animating = !(prefersReduced || still);
    const breathes = breathe > 0 && !prefersReduced;
    /* A `still` field that breathes has a loop , one that draws nothing but
       the breathing cells. See `breathFrame`. */
    const looping = animating || breathes;

    // Resolve the foreground token to plain "r,g,b" via a 1×1 offscreen canvas
    // , robust no matter what color syntax (oklch, rgb…) the browser computes.
    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    const probeCtx = probe.getContext("2d", { willReadFrequently: true });
    // Resolve any CSS color string (oklch, rgb…) to [r,g,b].
    const toRgb = (color: string, fallback: [number, number, number]) => {
      if (!probeCtx || !color) return fallback;
      probeCtx.clearRect(0, 0, 1, 1);
      probeCtx.fillStyle = "#000";
      probeCtx.fillStyle = color; // ignored if the browser can't parse it
      probeCtx.fillRect(0, 0, 1, 1);
      const [r, g, b] = probeCtx.getImageData(0, 0, 1, 1).data;
      return [r, g, b] as [number, number, number];
    };

    let fg: [number, number, number] = [23, 23, 23]; // dot color (foreground token)
    let primary: [number, number, number] = [230, 120, 50]; // warm light (tint token)
    // Theme-adjusted opacities. A light dot on a dark canvas reads clearly even
    // when faint, but a dark dot on light paper needs more alpha to feel equally
    // present (Weber's law), so in light themes we lift the far-from-focal dots.
    let baseAlpha = baseOpacity;
    let peakAlpha = maxOpacity;
    let fabricRangeInverse = 1 / Math.max(1e-6, peakAlpha - baseAlpha);
    /**
     * The moving half of the light. `--brand-hue` is animated by an ancestor
     * (`.spectrum-room` in globals.css) and inherits down to this canvas, so
     * reading it here is how the ambient wash ends up on the same timeline as
     * the mark's 24 bands without either one knowing about the other.
     *
     * `getComputedStyle` forces a style resolve, which is not a thing to do 60
     * times a second for one number , so the caller of this throttles it. A
     * hue that updates every few frames on a 3.2s turn is a hue nobody can
     * catch stepping.
     */
    const readTintHue = () => {
      if (!probeCtx || !tintHueVar) return;
      const raw = getComputedStyle(canvas).getPropertyValue(tintHueVar).trim();
      const angle = Number.parseFloat(raw) || 0;
      primary = toRgb(`oklch(0.72 0.19 ${tintHue + angle}deg)`, primary);
    };

    let fabricRecolor = false;
    const readColor = () => {
      if (!probeCtx) return;
      fg = toRgb(getComputedStyle(canvas).color, fg);
      if (tintHueVar) {
        readTintHue();
      } else {
        primary = toRgb(
          getComputedStyle(document.documentElement)
            .getPropertyValue(tintVar)
            .trim(),
          primary,
        );
      }
      // Dark foreground ⇒ light theme ⇒ boost so the dots stay visible everywhere.
      const lum = (0.2126 * fg[0] + 0.7152 * fg[1] + 0.0722 * fg[2]) / 255;
      const lightTheme = lum < 0.5;
      baseAlpha = lightTheme ? Math.min(baseOpacity * 2.8, 0.22) : baseOpacity;
      peakAlpha = lightTheme ? Math.min(maxOpacity * 1.2, 0.5) : maxOpacity;
      fabricRangeInverse = 1 / Math.max(1e-6, peakAlpha - baseAlpha);
      fabricRecolor = true;
    };

    let width = 0;
    let height = 0;
    let canvasBox: DOMRect | null = null;
    let raf = 0;
    let running = true;
    let lastRetarget = 0;
    let dpr = 1;
    /* The snapped box the light occupied on the last painted frame, or `null`
       for "treat the whole canvas as stale". */
    let prevBox: [number, number, number, number] | null = null;
    /* The last held crest's support. Its old and new boxes are both stale
       when the pointer moves; a travelling crest still takes the full sweep. */
    let prevHeldBoxes: Footprint[] = [];
    let prevRippleBoxes: Footprint[] = [];
    let now = 0; // latest frame timestamp, shared with the ripple math
    /* The grid, laid out once per resize , see `layoutCells`. A dot is an
       INDEX from here on, `row * cols + col`, and everything it owns lives in
       a flat array under that index: where it sits, whether and how it
       breathes, and what was last drawn for it. */
    let cols = 0;
    let rows = 0;
    let cellX = new Float64Array(0);
    let cellY = new Float64Array(0);
    /* WHERE THE CELLS ARE, which the camera decides (see `viewport.ts`).
       `step` is the screen distance between drawn dots and `gridX, gridY` the
       top-left edge of cell (0, 0), in (-step, 0]. Every conversion between a
       screen coordinate and a cell index goes through these three; at the
       identity viewport they are `gap, 0, 0` and every formula below reduces
       to the one it replaced. */
    const kept = floorRef.current?.gap === gap ? floorRef.current : null;
    let view = kept ? kept.view : normalizeViewport(viewportProp.current);
    /* Set by the first controller viewport: from then on the prop is ignored,
       so a host that drives the camera imperatively is never overruled by a
       stale prop on a re-render. */
    let viewFromController = false;
    let viewDirty = false;
    /* The camera the floor was last carried to, and whether the next camera
       starts a new floor instead: true until one exists, so a host's first
       camera places the floor rather than zooming it (and sending a wave)
       from the identity it never showed. */
    let floorView = view;
    let reseed = !kept;
    let lattice: SurfaceFieldLattice = kept ? kept.lattice : seedLattice(gap, view);
    let step = lattice.step;
    let gridX = lattice.originX;
    let gridY = lattice.originY;
    /* Where the hand last was over the field, in field px: where a zoom whose
       fixed point is off the canvas is anchored instead (see `pickZoomAnchor`). */
    let hand: { x: number; y: number } | null = null;
    let lastZoomWave = -Infinity;
    /* The breath, hashed once per cell instead of three hashes per dot per
       frame. `breathPeriod` holds exactly the double `breathDip` used to
       divide by, so the sine sees the same argument to the last bit. */
    let breathOn = new Uint8Array(0);
    let breathPeriod = new Float64Array(0);
    let breathPhase = new Float64Array(0);
    /* The cells that breathe, as indices, and how many , so `renderBreath`
       can tell a handful of cells from most of the field. */
    let breathIdx = new Int32Array(0);
    /* The buffer `breathIdx` is a view of, so a relayout does not allocate. */
    let breathList = new Int32Array(0);
    /* WHAT IS ON THE CANVAS FOR EACH CELL , see `sweep`. `null` is "unknown,
       repaint it", `""` is "nothing drawn there". */
    let drawnStyle: (string | null)[] = [];
    let drawnR = new Float64Array(0);
    let drawnX = new Float64Array(0);
    let drawnY = new Float64Array(0);
    let oldR = new Float64Array(0);
    let oldX = new Float64Array(0);
    let oldY = new Float64Array(0);
    let oldVisible = new Uint8Array(0);
    let damage = new Uint8Array(0);
    let damageCells = new Int32Array(0);
    let drawnFabricAlpha = new Float64Array(0);
    let drawnBaseFabricAlpha = new Float64Array(0);
    let fabricDirty = new Int32Array(0);
    let fabricDirtyCount = 0;
    let lastFabricShapes: Footprint[] = [];
    let lastFabricWeight = 0;
    let lastFabricFields: { id: string; rect: Footprint; weight: number }[] = [];
    const fabricFieldSnapshot = () => lineFields.map(field => ({
      id: field.id, rect: { ...field }, weight: field.weight,
    }));
    let dirty = new Int32Array(0);
    let lastBreath = 0; // timestamp of the last breath-only frame
    /* The breath's alarm clock while the light is at rest , see `snooze`. */
    let timer = 0;
    /* Whether the previous frame was a settled one, so the frame that ARRIVES
       still repaints the light in full and only the ones after it go cheap. */
    let resting = false;

    // Click ripples: expanding rings that briefly lift the dots they cross.
    type Footprint = { left: number; top: number; right: number; bottom: number };
    type SelectedField = Footprint & { id: string; parent: string | null; weight: number; target: number; turning: boolean };
    const scene = new Map<string, SelectedField>();
    const activeFields: SelectedField[] = [];
    const lineFields: SelectedField[] = [];
    const nearbyFields = new Set<SelectedField>();
    const bins = new Map<number, Map<number, SelectedField[]>>();
    const broadFields: SelectedField[] = [];
    const binSize = Math.max(focusRadius, 1);
    let sceneSnapshot: SurfaceFieldScene | null = null;
    let sceneDirty = false;
    let selectionTurning = false;
    let lastFieldFrameAt = performance.now();
    let prevSelectionBoxes: Footprint[] = [];
    const oldSceneBoxes: Footprint[] = [];
    const fieldBox = (shape: SelectedField | Footprint): Footprint => {
      const pad = focusRadius + Math.max(dotPeak, Math.abs(ripplePush), Math.abs(rippleWidth)) + 2;
      return {
        left: snap(shape.left - pad, false, width, gridX),
        top: snap(shape.top - pad, false, height, gridY),
        right: snap(shape.right + pad, true, width, gridX),
        bottom: snap(shape.bottom + pad, true, height, gridY),
      };
    };
    const selectionBoxes = () => {
      const boxes = [...oldSceneBoxes, ...activeFields.filter(field => field.turning).map(fieldBox)];
      oldSceneBoxes.length = 0;
      return boxes;
    };
    const fieldDistance2 = (x: number, y: number, shape: Footprint) => {
      const dx = x < shape.left ? x - shape.left : x > shape.right ? x - shape.right : 0;
      const dy = y < shape.top ? y - shape.top : y > shape.bottom ? y - shape.bottom : 0;
      return dx * dx + dy * dy;
    };
    const indexScene = () => {
      bins.clear();
      broadFields.length = 0;
      for (const field of scene.values()) {
        const x0 = Math.floor((field.left - focusRadius) / binSize);
        const y0 = Math.floor((field.top - focusRadius) / binSize);
        const x1 = Math.floor((field.right + focusRadius) / binSize);
        const y1 = Math.floor((field.bottom + focusRadius) / binSize);
        /* A giant visible frame still costs one candidate, not a bucket for
           every cell of a potentially unbounded model rectangle. */
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) {
          broadFields.push(field);
          continue;
        }
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          let column = bins.get(x);
          if (!column) bins.set(x, column = new Map());
          let bucket = column.get(y);
          if (!bucket) column.set(y, bucket = []);
          bucket.push(field);
        }
      }
    };
    const refreshScene = () => {
      if (!sceneDirty) return;
      sceneDirty = false;
      const snapshot = sceneSnapshot;
      const rects = snapshot?.rects ?? [];
      const boardBox = snapshot?.root.getBoundingClientRect();
      const canvasBox = canvas.getBoundingClientRect();
      const ox = (boardBox?.left ?? 0) - canvasBox.left;
      const oy = (boardBox?.top ?? 0) - canvasBox.top;
      const present = new Set<string>();
      for (const rect of rects) {
        if (![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) || rect.right <= rect.left || rect.bottom <= rect.top) continue;
        const left = rect.left + ox, top = rect.top + oy;
        const right = rect.right + ox, bottom = rect.bottom + oy;
        if (right + focusRadius < 0 || bottom + focusRadius < 0 || left - focusRadius > width || top - focusRadius > height) continue;
        present.add(rect.id);
        let field = scene.get(rect.id);
        if (!field) {
          field = { id: rect.id, parent: rect.parent, left, top, right, bottom, weight: 0, target: 1, turning: false };
          scene.set(rect.id, field);
        } else if (field.left !== left || field.top !== top || field.right !== right || field.bottom !== bottom) {
          if (field.weight > 0) oldSceneBoxes.push(fieldBox(field));
          field.turning = true;
        }
        field.parent = rect.parent;
        field.left = left;
        field.top = top;
        field.right = right;
        field.bottom = bottom;
      }
      for (const [id, field] of scene) if (!present.has(id)) {
        if (field.weight > 0) oldSceneBoxes.push(fieldBox(field));
        scene.delete(id);
        nearbyFields.delete(field);
      }
      indexScene();
    };
    const retargetSelection = () => {
      /* Every visible layer owns the same complete field as a held layer.
         Identity keeps the source stable through selection and pointer moves. */
      for (const field of scene.values()) {
        field.target = 1;
        nearbyFields.add(field);
      }
    };
    const advanceSelection = (time: number) => {
      /* The canvas may deliver only a few frames during a costly selection
         press. A frame-count fade then takes seconds in wall time. Keep the
         same gentle rise at normal refresh rates, and catch up to elapsed time
         on the first frame after a stall. */
      const elapsed = Math.max(0, time - lastFieldFrameAt);
      lastFieldFrameAt = time;
      const ease = 1 - Math.exp(-elapsed / 85);
      if (!sceneDirty && !scene.size && !nearbyFields.size && !activeFields.length) {
        selectionTurning = false;
        return;
      }
      for (const field of nearbyFields) field.turning = false;
      refreshScene();
      retargetSelection();
      activeFields.length = 0;
      lineFields.length = 0;
      selectionTurning = false;
      for (const field of nearbyFields) {
        const delta = field.target - field.weight;
        if (Math.abs(delta) < 0.004) field.weight = field.target;
        else { field.weight += delta * ease; field.turning = true; selectionTurning = true; }
        if (field.weight > 0) activeFields.push(field);
        else nearbyFields.delete(field);
        if (field.weight > 0) lineFields.push(field);
      }
    };
    const ripples: { x: number; y: number; start: number; held?: boolean; gain?: number; life?: number; footprints?: Footprint[]; footprintAt?: number; source?: "nodes" | "marquee"; ids?: readonly string[] }[] = [];
    let preview: { shapes: Footprint[]; weight: number; target: number; holdUntil: number } | null = null;
    let previewTurning = false;
    let lastPreviewFrameAt = performance.now();
    const advancePreview = (time: number) => {
      const elapsed = Math.max(0, time - lastPreviewFrameAt);
      lastPreviewFrameAt = time;
      if (!preview) { previewTurning = false; return; }
      if (!preview.target && time < preview.holdUntil) {
        previewTurning = true;
        return;
      }
      const delta = preview.target - preview.weight;
      if (Math.abs(delta) < 0.004) preview.weight = preview.target;
      else preview.weight += delta * (1 - Math.exp(-elapsed / (preview.target ? 55 : 85)));
      previewTurning = preview.weight !== preview.target;
      if (!previewTurning && !preview.target) preview = null;
    };

    /* ═══ AND THE ONES ASKED FOR BY THE LAYOUT ABOVE ══════════════════════
       .
       `pending` is written by an effect on the `ripple` prop and drained here,
       which is the one shape that works across this boundary: the array above
       lives in this effect's closure and cannot be reached from a render, and
       re-running this effect to add a ring would tear down the canvas, the
       observers and the animation loop to draw a circle.
       .
       Drained at the top of every frame rather than on arrival, so a ring
       asked for while the tab is hidden starts when the tab is painting
       again instead of being aged out before anybody sees it. */
    const drainPending = () => {
      if (!pending.current.length) return;
      for (const p of pending.current) {
        ripples.push({ x: p.x, y: p.y, start: now || performance.now() });
        if (ripples.length > 5) ripples.shift();
      }
      pending.current = [];
    };

    // Focal point (CSS px): `f` is where it is, `t` is where it's heading.
    let fx = 0;
    let fy = 0;
    let tx = 0;
    let ty = 0;
    let pointerInside = false;
    let cursorHovering = false;
    let cursorWeight = 0;
    let lastCursorFrameAt = performance.now();
    /* ═══ A HAND THAT IS CARRYING SOMETHING IS NOT POINTING AT THE FIELD ═══
       .
       The listeners are on `window`, so a press anywhere over the canvas is the
       field's , including one that picks up a frame on the board drawn above
       it. That press dropped a ring, and a ring is a FULL sweep per frame for
       as long as it takes to cross the canvas: at 0.6 px/ms about three
       seconds, which is the whole of an ordinary drag, and it was measured at
       ~15% of the main thread the drag runs on (f1, Banco). The light chasing
       the hand added its neighbourhood on top, every frame.
       .
       A work-area press keeps one crest under the hand even when it carries a
       frame. The field only observes the pointer; the board still owns its
       gesture and capture. Other uses retain the old travelling-press
       suppression. `DRAG_PX` is the slop a steady tap wanders on a trackpad. */
    const DRAG_PX = 4;
    const RIPPLE_RISE_MS = 90;
    /* ═══ A ZOOM IS ANSWERED BY THE FLOOR, NOT PRESSED INTO IT ═══════════
       .
       A zoom sends one of the ordinary rings out from where it is anchored,
       so the floor visibly takes part in a gesture it otherwise only
       half-follows (see `parallaxScale`). It is the camera moving, not a hand
       touching the floor, so it is quieter than a press: 0.4 of a press's
       lift, glow and push, which at the default settings is a 2.4px shove
       and a crest that brightens without warming the dots into the accent.
       .
       A pinch or a wheel is a stream of camera changes, sixty a second. One
       ring each would be a solid wall of crests; one every 250ms spaces them
       150px apart at the default 0.6px/ms, four crest widths, so a long zoom
       reads as a slow pulse of separate rings. A zoom that lasts under 250ms
       is one ring.
       .
       And a wave fades out over 1s, not over the canvas diagonal as a press
       does (about 3s on a large screen): 600px at the default speed, which
       is the neighbourhood of the gesture, and exactly four waves alive at
       the fastest rate. The ring slots are five, so a steady zoom never has
       to cut a crest off mid-fade and a press always finds a slot. */
    const ZOOM_WAVE_GAIN = 0.4;
    const ZOOM_WAVE_INTERVAL_MS = 250;
    const ZOOM_WAVE_LIFE_MS = 1000;
    let press: { x: number; y: number; pointerId: number; ring: (typeof ripples)[number] | null } | null = null;
    /* `pointerup` is captured before the board flushes its final queued move.
       Keep that ring for this one task so its last snapped box can still land. */
    let released: { pointerId: number; ring: (typeof ripples)[number]; at: number; from: number } | null = null;
    let carrying = false;
    let owed = false; // one full sweep, to clear the rings a carry dropped
    /* ═══ AN EMPTY ROOM IS NOT WORTH LIGHTING ══════════════════════════════
       .
       The focal WANDERS when no hand is on it: `pickTarget` re-aims it at a
       random point every 2.6s and the focal eases toward it at 0.02, which is
       ~431 frames to cover a canvas , re-aimed 2.8x faster than it can arrive.
       The light therefore never converges BY CONSTRUCTION, and the loop it
       feeds can never rest: ~3,400 dots redrawn sixty times a second, for ever,
       whether or not anybody is in the app.
       .
       So the wander is what the window's focus gates, and not the loop itself.
       Focused, every frame is exactly the frame it was before , drift, chase,
       rings, all of it. Unfocused, nothing re-aims the light and it finishes
       its travel.
       .
       WHAT HAPPENS THEN DEPENDS ON THE BREATH, and only on it. With `breathe`
       at 0 the light arrives, `settled` puts the loop down, and the field
       costs nothing until a hand comes back. With a breath on, the loop stays
       up and goes nearly free instead , that trade is argued at `breathing` in
       `frame`. Either way the LIGHT is still, which is the thing this gate was
       for.
       .
       NOT `document.hidden`, which is the guard this file already has and which
       cannot serve here: Electron's main process sets
       `disable-backgrounding-occluded-windows` for the source view's sake, and
       that keeps this document visible for the life of the app. */
    let focused = typeof document !== "undefined" ? document.hasFocus() : true;

    const pickTarget = () => {
      tx = Math.random() * width;
      ty = Math.random() * height;
    };

    const resize = () => {
      sceneDirty = true;
      const rect = canvas.getBoundingClientRect();
      canvasBox = rect;
      /* ═══ AND AN ADDRESS BAR SLIDING IS NOT A RESIZE ═════════════════════
         .
         WHAT THE TWO LINES BELOW COST. Writing `canvas.width` throws the
         backing store away and allocates a new one, and on a phone this
         surface is the width of the window by more than half its height:
         780 by 1146 device pixels, 3.58 MB, measured. It also resets the
         context, so the transform and the colour have to be read again.
         .
         AND ON A PHONE IT WAS FIRING THROUGH EVERY SCROLL. Wherever this
         field is sized against the viewport, iOS collapsing and expanding its
         chrome changes this element's height continuously as somebody reads,
         so a buffer of several megabytes was being thrown away and rebuilt
         over and over, for a band whose width never moved.
         .
         SO A HEIGHT THAT MOVES BY LESS THAN THE BAR IS IGNORED. The canvas
         keeps the taller of the two, which is a few rows of dots drawn below
         the fold rather than a reallocation: the cheaper wrong answer by a
         factor of thousands. A width change, a rotation or a keyboard all
         move it by more than this and go through. */
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const nextW = Math.round(rect.width * dpr);
      const nextH = Math.round(rect.height * dpr);
      if (
        canvas.width === nextW &&
        canvas.height >= nextH &&
        canvas.height - nextH < 120 * dpr
      ) {
        width = rect.width;
        height = canvas.height / dpr;
        /* AND THE COLOUR IS STILL READ, WHICH THIS GUARD SKIPPED. `fg` and
           `primary` are locals of this effect seeded to a light-mode default,
           and the effect re-runs on any of its fourteen dependencies. A re-run
           finds the canvas already the right size, takes this road, and paints
           with the seed: in dark mode the grain was invisible while the loop
           went on paying for it. The early return is about not reallocating a
           buffer, and it has no business skipping anything else. */
        readColor();
        layoutCells(false);
        prevBox = null;
        if (fabric && fabricCtx && (fabric.width !== nextW || fabric.height !== canvas.height)) {
          fabric.width = nextW;
          fabric.height = canvas.height;
          fabricCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
          render();
        }
        return;
      }
      width = rect.width;
      height = rect.height;
      canvas.width = nextW;
      canvas.height = nextH;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (fabric && fabricCtx) {
        fabric.width = nextW;
        fabric.height = nextH;
        fabricCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      lastStyle = ""; // the new backing store came with a fresh context
      readColor();
      layoutCells(true);
      if (!now) now = performance.now(); // the breath needs a clock, even off-loop
      if (fx === 0 && fy === 0) {
        fx = tx = width * 0.5;
        fy = ty = height * 0.5;
      }
      render(); // paint immediately , setting canvas size cleared it, and RAF may be throttled
    };

    /* ═══ WHAT A FRAME COSTS, AND WHY IT USED TO COST IT THOUSANDS OF TIMES
       .
       This field is ~3,300 dots on a workspace-sized canvas, and every one of
       them used to pay for `ctx.fillStyle =` plus a freshly built `rgba(...)`
       string, its own `beginPath`, and its own `fill`. Sixty times a second
       that is ~200,000 string allocations per second handed to a colour
       parser and 3,300 separate rasteriser set-ups , for a picture in which
       the large majority of the dots are IDENTICAL to one another.
       .
       A dot outside `focusRadius`, with no crest crossing it, is always the
       same dot: `baseAlpha`, `fg`, `dotBase`. Always. So the far field is not
       thousands of drawing operations, it is ONE: one colour, one path of
       many circles, one fill. Only the dots actually in the light are worth
       touching individually.
       .
       AND IT IS DRAWN STRAIGHT ONTO THE CANVAS, not cached into an offscreen
       one and blitted. That was tried first and it is wrong here, which is
       worth writing down: at `baseAlpha` 0.02 a dot is 5/255, so an
       intermediate 8-bit buffer quantises the antialiased edge twice and the
       faint half of every dot rounds away. The parity harness caught it as
       20,000 changed pixels and a mean alpha that had drifted up , fewer,
       harder dots. Skia rasterises one path of 2,400 disjoint circles at full
       internal precision and composites once, which is the same picture; a
       round trip through 8 bits is not.
       .
       The arithmetic per dot is untouched. Every constant, every smoothstep,
       every clamp is the one that was here before. What changed is how many
       dots need their own draw call, and how many strings get built to say a
       colour that was already said. */

    const TAU = Math.PI * 2;
    const dotBase = 0.8; // dot radius with no light on it
    const dotPeak = 1.5; // established max dot radius , the wave must not exceed it

    /* ═══ THE ASYMMETRY, AND WHY IT IS HASHED AND NOT ROLLED ══════════════
       .
       A dot picked at random every frame is noise: it has no identity, the
       eye reads it as the canvas being unstable, and it costs a `Math.random`
       per dot per frame. A dot picked by HASHING ITS OWN COORDINATES is the
       same dot every time the frame is drawn, so it has a period, a phase and
       a place , which is what makes the field feel irregular rather than
       noisy. It also makes the whole thing stateless: `renderBreath` and a
       full `render` compute the identical value for the identical dot without
       sharing anything but the clock.
       .
       HOW MANY IS THE CALLER'S (`breathe`), AND THE DEFAULT IS EVERY DOT.
       .
       THAT IS A CHOSEN MAXIMUM AND NOT A TUNED NUMBER, which is worth saying
       plainly so the next person does not read it as the considered answer:
       the dial was turned to the end on purpose, because what this surface
       wanted was the most intermittence it could have and not the most it
       could get away with , on the DENSITY axis only; the rate stayed at its
       tuned 1. The reasoning below is the reasoning for the LADDER, and it
       still stands: it is what tells you which way to go when this turns out
       to be too much. The quiet setting is 0.2.
       .
       It started at one in eighty, which on a field of fourteen hundred dots
       is fifteen cells with four of them down at any instant , and four
       events on a whole screen is not texture, it is something the eye finds
       ONE AT A TIME, which is the opposite of what this is for. The number
       went up three times in visual trials, and the reading each
       time was the same: THE EFFECT ONLY STOPS BEING A LIST OF INCIDENTS AND
       STARTS BEING A PROPERTY OF THE MATERIAL ONCE THERE ARE TOO MANY OF
       THEM TO COUNT. At 0.2 that field has two hundred and eighty breathing
       and sixty-odd down at any instant, and it is the first setting where
       the eye stops following individual dots and just reads the surface as
       alive.
       .
       WHAT IS ABOVE IT, so the next person turning this knows what they are
       walking into: past roughly one in three the field no longer has a
       resting state to depart from. Everything is always going somewhere,
       the grid reads as UNSTABLE rather than as irregular, and what was grain
       becomes a shimmer , an effect, which is the thing this was built not to
       be. The dial in the lab runs all the way to 1 anyway; that is where you
       go to see the wall rather than to take the number.
       PERIODS ARE SPREAD over four and a half seconds so no two neighbours
       can fall into step and expose the grid again, and the MINIMUM is 4.2s
       because anything quicker stops being a breath and starts being a blink,
       which is a thing the eye is built to catch.
       .
       DEPTH 0.8 AND NOT 1: the dot goes most of the way to nothing and never
       all of it. A dot that reaches zero leaves a HOLE in the lattice, and a
       hole is a shape , the eye finds it and the grid is legible again from
       the gap. A dot at a fifth is merely further away. */
    /* Clamped here and not at the prop, so one bad number cannot make a
       field where every dot breathes or where the maths runs on a negative. */
    const density = Math.min(Math.max(breathe, 0), 1);
    /* Floored well above zero: a rate of 0 would divide the period to infinity
       and freeze every dot wherever its phase happened to put it , some of
       them at nothing. `breathe = 0` is how this is turned off. */
    const rate = Math.min(Math.max(breatheRate, 0.05), 20);
    /* ═══ IT IS AN EVENT, NOT A DRIFT, AND THAT IS WHAT WAS WRONG ════════
       .
       This was built as a BREATH first: 4.2 to 9 seconds a cycle, down to a
       fifth, on a gentle curve. On the bench, beside nothing, it read. On the
       home screen and on the workspace canvas it was INVISIBLE at any density
       , turn the dial to every-dot-breathing and the field still looked
       static , and the reason is not how many there are.
       .
       A dot here peaks at 0.2 alpha: fifty values out of 255 on a dark ground.
       A change that small is read by the eye only if it happens FAST. Take a
       second and a half to fade it and the visual system does what it is built
       to do with slow low-contrast change , it adapts to it and reports
       nothing. The dot was always fading; nobody was ever going to see it.
       .
       So all three numbers move together, and they are one decision:
       .
       · 1.5–4.1s instead of 4.2–9. Fast enough to be an EVENT , something
         that happened , rather than a level that drifted. `breatheRate`
         scales it, and it is the one axis NOT run to the end of its rail:
         4x puts the cycles at 0.4 to 1.0 seconds, and a field at that speed
         has stopped blinking and started strobing.
       · THE SIXTH POWER instead of the third. The dot holds still for most of
         its cycle and the whole excursion lands inside a few tenths of a
         second. That shape is the difference between a dot that is never
         quite itself and a dot that blinks.
       · ALL THE WAY DOWN. The earlier argument for stopping at 0.8 was that a
         dot reaching zero leaves a HOLE, and a hole is a shape the eye can
         find. That argument was right and it was answering the wrong
         question: at this speed the dot is gone for a fraction of a second,
         so there is never a hole to read , there is a blink. A fifth of 50 is
         10/255 and a blink to 10 is not a blink.
       .
       Under reduced motion none of this runs at all, which matters more now
       than it did: this is the flickering kind of motion, and that is exactly
       what that setting is for. */
    const BREATH_MIN = 1500; // ms, the fastest cycle allowed
    const BREATH_SPAN = 2600; // ms of spread above that, so none of them sync
    const BREATH_DEPTH = 1; // all the way out, for the moment it is out

    /* Coordinates in, a stable [0,1) out. `salt` gives one cell as many
       independent draws as it needs , which one breathes, how fast, and where
       in its own cycle it starts , from one function and no storage. */
    const hash = (a: number, b: number, salt: number) => {
      let h = (a * 374761393 + b * 668265263 + salt * 2246822519) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };

    /** 0 for the overwhelming majority of dots, up to 1 at the bottom of a
        breath for the few that have one. `i` is the cell's index; its period
        and phase were hashed from (col, row) by `layoutCells`. */
    const breathDip = (i: number) => {
      if (!breathOn[i]) return 0;
      const s = Math.sin((now / breathPeriod[i] + breathPhase[i]) * TAU);
      if (s <= 0) return 0;
      /* THE SIXTH POWER, in three multiplies. See BREATH_MIN above for why it
         is not the third: this is what puts the whole excursion inside a few
         tenths of a second instead of spreading it across a quarter of the
         cycle. */
      const w = s * s * s;
      return w * w;
    };

    const focusRadius2 = focusRadius * focusRadius;
    /* Every visible layer and the hand share this mesh profile. At a quarter
       of the dot light's reach, the broad outer field reads as dots alone. */
    const fabricRadius = lineRadius;
    const fabricRadius2 = fabricRadius * fabricRadius;

    /* A carried element lights the field by its AREA. The ripple below already
       uses its rectangle; leaving the brighter focal at the grab point made
       the visible dots pile up on whichever corner the hand first touched. */
    let focusShapes: Footprint[] | undefined;
    let focusShapeWeight = 0;
    let fabricFocus = 0;
    const carriedIds = new Set<string>();
    const sourceWeight = (field: SelectedField) => field.weight * (carriedIds.has(field.id) ? 1 - focusShapeWeight : 1);
    const emptyFields: SelectedField[] = [];
    const candidateSets: [SelectedField[], SelectedField[]] = [activeFields, emptyFields];
    let useFieldBins = false;
    const candidatesAt = (x: number, y: number) => {
      candidateSets[0] = useFieldBins
        ? bins.get(Math.floor(x / binSize))?.get(Math.floor(y / binSize)) ?? emptyFields
        : activeFields;
      candidateSets[1] = useFieldBins ? broadFields : emptyFields;
      return candidateSets;
    };
    const focusFalloff = (d2: number, radius: number, radius2: number) => {
      if (d2 >= radius2) return 0;
      const t = 1 - Math.sqrt(d2) / radius;
      return t * t * (3 - 2 * t);
    };

    /** How much light is on the dot at (x, y): 0 outside the focal, 1 at its
        centre, and 1 everywhere when the field is a texture. */
    const focusAt = (x: number, y: number) => {
      if (still) {
        fabricFocus = 1;
        return 1;
      }
      let shapeLight = 0;
      let shapeFabric = 0;
      let selectedLight = 0;
      let selectedFabric = 0;
      for (const group of candidatesAt(x, y)) for (const field of group) {
        const weight = sourceWeight(field);
        if (weight <= 0) continue;
        const d2 = fieldDistance2(x, y, field);
        if (d2 === 0) continue;
        selectedLight = Math.max(selectedLight, focusFalloff(d2, focusRadius, focusRadius2) * weight);
        if (fabricCtx) {
          selectedFabric = Math.max(selectedFabric, focusFalloff(d2, fabricRadius, fabricRadius2) * weight);
        }
      }
      if (focusShapes && focusShapeWeight > 0) {
        for (const shape of focusShapes) {
          const d2 = fieldDistance2(x, y, shape);
          shapeLight = Math.max(shapeLight, focusFalloff(d2, focusRadius, focusRadius2));
          if (fabricCtx) shapeFabric = Math.max(shapeFabric, focusFalloff(d2, fabricRadius, fabricRadius2));
        }
      }
      const dx = x - fx;
      const dy = y - fy;
      /* SQUARED FIRST, AND `Math.hypot` NOT AT ALL. `hypot` is careful about
         overflow at 1e300 and charges for that care on every call; these are
         screen coordinates. The root is then taken only for the dots actually
         in the light , the smoothstep needs the distance, the rejection test
         does not. (Measured against `hypot` over 390 frames of the parity
         harness: not one pixel differs.) */
      const d2 = dx * dx + dy * dy;
      /* A resting layer is already at full weight. The pointer still owns its
         local light, so scene weight cannot be used to gate this source. */
      const cursorLight = focusFalloff(d2, focusRadius, focusRadius2);
      if (fabricCtx) {
        const cursorFabric = focusFalloff(d2, fabricRadius, fabricRadius2);
        fabricFocus = Math.max(shapeFabric * focusShapeWeight, selectedFabric, cursorFabric * (1 - focusShapeWeight));
      }
      return Math.max(shapeLight * focusShapeWeight, selectedLight, cursorLight * (1 - focusShapeWeight));
    };

    /* ═══ THE COLOUR IS SAID IN 256 WORDS, BECAUSE THE CANVAS ONLY HEARS 256
       .
       Building `rgba(...)` per dot per frame was the whole of this field's
       garbage: a string for every dot drawn, handed to a colour parser and
       dropped, which on a workspace-sized field is enough to bring the major
       collector round in the middle of somebody's click , measured, a
       144ms pause and nine tenths of the main thread.
       .
       WHAT MAKES A CACHE EXACT: Blink quantises a fill colour's alpha to
       EIGHT BITS before anything is rasterised, so every alpha that lands on
       the same byte draws the same pixels, and one string per byte says it.
       Measured on this Electron, dots at dpr 2 on the GPU canvas: ninety
       thousand of them, half placed deliberately next to a rounding
       boundary, and not one channel differs from the string built fresh.
       .
       EXCEPT RIGHT ON THE BOUNDARY, which is why the guard. Where an alpha
       sits within a thousandth of a byte of a half, the parser and
       `Math.round` may round it opposite ways , Blink's own threshold wanders
       by up to 2e-5 of a byte either side of the half, measured , and there
       the string is built exactly as before. That is one dot in five hundred,
       and fifty times the margin the drift needs.
       .
       `globalAlpha` with one constant colour was the other candidate and it
       is NOT the same picture: ~3,600 channels of a 2,400-dot field differ,
       up to 64 levels on a dark ink. Blending a paint alpha is not the same
       arithmetic as parsing one. */
    const styles = new Map<number, string>();
    const styleFor = (r: number, g: number, b: number, alpha: number) => {
      const v = alpha * 255;
      const k = Math.round(v);
      if (Math.abs(v - k) > 0.499) return `rgba(${r},${g},${b},${alpha})`;
      const key = ((r * 256 + g) * 256 + b) * 256 + k;
      let s = styles.get(key);
      if (s === undefined) {
        /* Bounded because a tinted field can ask for a colour per step of
           warmth; four thousand is more than one theme ever uses. */
        if (styles.size > 4096) styles.clear();
        s = `rgba(${r},${g},${b},${k / 255})`;
        styles.set(key, s);
      }
      return s;
    };
    /* What `ctx.fillStyle` currently holds, so a run of dots in the same
       colour sets it once. Reset wherever the context is. */
    let lastStyle = "";

    /* ═══ A DOT IS WORKED OUT, THEN DRAWN , AND ONLY IF IT CHANGED ════════
       .
       `evalDot` is the arithmetic the field has always done for one dot,
       untouched: every constant, smoothstep and clamp is the one that was
       here. What it no longer does is draw. It leaves four numbers , the
       colour string, the radius, and where the crests pushed the centre ,
       and those four ARE the dot: the same four on a cleared cell paint the
       same pixels, every time, because nothing else reaches into a cell.
       .
       So a repaint compares them with what the cell was last drawn with, and
       a dot that would come out the same is not drawn again. On this field
       that is most of them on most frames: the far field is a constant, and
       a breathing dot only changes when its fade crosses a byte , a handful
       of steps per blink, not one per frame. */
    let dStyle = "";
    let dR = 0;
    let dX = 0;
    let dY = 0;
    let dFabricAlpha = 0;
    let dBaseFabricAlpha = 0;
    const rippleSupport = 4 * Math.abs(rippleWidth);
    const cursorReach = Math.max(0, cursorPushRadius);
    const cursorReach2 = cursorReach * cursorReach;
    const cursorScale = cursorReach > 0 ? Math.max(0, cursorPush) * 27 / (4 * cursorReach) : 0;
    /* The edge stays empty ON the surface at every setting. A negative value
       shortens only the exterior fade; it never paints inside the rectangle. */
    const edgeWidth = Math.max(0, Math.abs(rippleWidth) + (Number.isFinite(surfacePadding) ? surfacePadding : 0));
    const edgeWidth2 = edgeWidth * edgeWidth;
    /* A ring's age, crest radius and amplitude are identical for every dot
       in a frame. Keep five reusable slots rather than doing that arithmetic
       for each cell or allocating a ring record on every frame. */
    const preparedRipples = Array.from({ length: 5 }, () => ({
      x: 0, y: 0, radius: 0, amp: 0, near2: 0, far2: 0, bounded: false,
      footprints: undefined as Footprint[] | undefined,
    }));
    let preparedCount = 0;
    const prepareRipples = () => {
      /* Many live node fields use the scene's local bins, so every dot does
         not scan every visible layer on a crowded board. */
      useFieldBins = activeFields.length > 8;
      const heldShapes = press?.ring?.held && press.ring.source !== "marquee" ? press.ring.footprints : undefined;
      carriedIds.clear();
      if (heldShapes?.length) {
        focusShapes = heldShapes;
        /* Let the light grow from the grab into the surface over the crest's
           existing rise, so the first moved pixel does not flash a huge box. */
        const progress = Math.max(0, Math.min(1, (now - (press?.ring?.footprintAt ?? now)) / RIPPLE_RISE_MS));
        focusShapeWeight = progress * progress * (3 - 2 * progress);
        for (const id of press?.ring?.ids ?? []) carriedIds.add(id);
      } else if (preview && preview.weight > 0) {
        focusShapes = preview.shapes;
        focusShapeWeight = preview.weight;
      } else if (released?.ring.footprints?.length && released.ring.source !== "marquee") {
        /* The travelling rectangular wave pays for these transition frames.
           Once it has gone, the ordinary pointer light is all that remains. */
        const progress = Math.max(0, Math.min(1, (now - released.at) / (3 * RIPPLE_RISE_MS)));
        focusShapeWeight = released.from * (1 - progress * progress * (3 - 2 * progress));
        focusShapes = focusShapeWeight > 0 ? released.ring.footprints : undefined;
      } else {
        focusShapes = undefined;
        focusShapeWeight = 0;
      }
      preparedCount = 0;
      const reach = Math.sqrt(width * width + height * height) || 1;
      for (const rp of ripples) {
        const age = now - rp.start;
        if (age < 0) continue;
        const waveAge = rp.held ? RIPPLE_RISE_MS : age;
        /* A carried rectangle starts its release at its OWN edge. The free
           press retains the old circle, whose crest has already risen 90ms. */
        const radius = rp.footprints ? Math.max(0, waveAge - RIPPLE_RISE_MS) * rippleSpeed : waveAge * rippleSpeed;
        /* A zoom wave fades over its own lifetime rather than the canvas
           diagonal; see ZOOM_WAVE_LIFE_MS. */
        const life = rp.life ? waveAge / rp.life : radius / reach;
        if (life >= 1) continue;
        const amp = (1 - life) * Math.min(1, waveAge / RIPPLE_RISE_MS) * (rp.gain ?? 1);
        if (amp < 0.002) continue;
        const slot = preparedRipples[preparedCount++];
        slot.x = rp.x;
        slot.y = rp.y;
        slot.footprints = rp.footprints;
        slot.radius = radius;
        slot.amp = amp;
        slot.bounded = !rp.footprints && radius >= 0 && Number.isFinite(rippleSupport);
        const far = radius + rippleSupport;
        const near = Math.max(0, radius - rippleSupport);
        slot.far2 = far * far;
        slot.near2 = near * near;
      }
    };
    const taperShape = (px: number, py: number, shape: Footprint, weight: number) => {
      const distance2 = fieldDistance2(px, py, shape);
      if (distance2 !== 0 && (edgeWidth <= 0 || distance2 >= edgeWidth2)) return 1;
      const u = distance2 === 0 ? 0 : Math.sqrt(distance2 / edgeWidth2);
      const fade = u * u * (3 - 2 * u);
      return 1 - weight * (1 - fade);
    };
    const shapeTaper = (px: number, py: number) => {
      let result = 1;
      if (focusShapes && focusShapeWeight > 0) for (const shape of focusShapes) {
        result = Math.min(result, taperShape(px, py, shape, focusShapeWeight));
      }
      const groups = candidatesAt(px, py);
      for (const group of groups) for (const field of group) {
        const weight = sourceWeight(field);
        if (weight <= 0) continue;
        if (fieldDistance2(px, py, field) === 0) {
          /* A container's inner floor is occupied by its children. Let a
             child's exterior own its field there while each actual layer
             interior remains empty. The parent still owns its outer rim. */
          let childExterior = false;
          for (const candidates of groups) for (const other of candidates) {
            if (other === field || sourceWeight(other) <= 0) continue;
            const d2 = fieldDistance2(px, py, other);
            if (d2 <= 0 || d2 >= focusRadius2) continue;
            for (let parent = other.parent; parent; parent = scene.get(parent)?.parent ?? null) {
              if (parent === field.id) { childExterior = true; break; }
            }
            if (childExterior) break;
          }
          if (childExterior) continue;
        }
        result = Math.min(result, taperShape(px, py, field, weight));
      }
      return result;
    };
    const evalDot = (
      x: number,
      y: number,
      t: number,
      dip: number,
    ) => {
      let wave = 0; // summed crest intensity for this dot
      let px = x;
      let py = y;
      for (let i = 0; i < preparedCount; i++) {
        const rp = preparedRipples[i];
        const shapes = rp.footprints;
        /* The distance from the RECTANGLE, not its centre, is what gives a
           wide or tall dragged element its actual footprint and soft edge. */
        let rdx = x - rp.x;
        let rdy = y - rp.y;
        if (shapes) {
          let nearest2 = Infinity;
          for (const shape of shapes) {
            const dx = x < shape.left ? x - shape.left : x > shape.right ? x - shape.right : 0;
            const dy = y < shape.top ? y - shape.top : y > shape.bottom ? y - shape.bottom : 0;
            const distance2 = dx * dx + dy * dy;
            if (distance2 < nearest2) { nearest2 = distance2; rdx = dx; rdy = dy; }
            if (nearest2 === 0) break;
          }
        }
        /* Outside four Gaussian widths, even full amplitude is below the
           existing 0.002 cutoff. Test squared distance before the root and
           exponential, especially for a crest crossing a large workspace. */
        if (rp.bounded || shapes) {
          const dist2 = rdx * rdx + rdy * rdy;
          if (dist2 > rp.far2 || dist2 < rp.near2) continue;
        }
        const rdist = Math.sqrt(rdx * rdx + rdy * rdy);
        const off = rdist - rp.radius; // signed distance from the crest
        const g = Math.exp(-(off * off) / (2 * rippleWidth * rippleWidth));
        const infl = g * rp.amp;
        if (infl < 0.002) continue;
        wave += infl;
        if (rdist > 0.01 && ripplePush) {
          if (shapes) {
            /* A RECTANGLE'S CREST PUSHES ALONG THE SQUIRCLE'S NORMAL, not the
               nearest point's: see `selectedPush` below for why. Its crest
               keeps the Euclidean distance, which is what the repaint boxes
               were sized for; only the direction is smoothed. */
            const cx = rdx * rdx * rdx;
            const cy = rdy * rdy * rdy;
            const push = infl * ripplePush / Math.sqrt(cx * cx + cy * cy);
            px += cx * push;
            py += cy * push;
          } else {
            const push = (infl * ripplePush) / rdist; // outward, normalised
            px += rdx * push;
            py += rdy * push;
          }
        }
      }

      let selectedWave = 0;
      let selectedPushX = 0;
      let selectedPushY = 0;
      for (const group of candidatesAt(x, y)) for (const field of group) {
        const weight = sourceWeight(field);
        if (weight <= 0) continue;
        const dx = x < field.left ? x - field.left : x > field.right ? x - field.right : 0;
        const dy = y < field.top ? y - field.top : y > field.bottom ? y - field.bottom : 0;
        const d2 = dx * dx + dy * dy;
        if (d2 === 0 || d2 > rippleSupport * rippleSupport) continue;
        /* ═══ A SURFACE LIFTS THE FABRIC ALONG A SQUIRCLE, NOT A RECTANGLE ═══
           .
           Measured from the nearest point of a sharp rectangle, the push is
           flat beside each side and radial past each corner, and the two
           meet on the sides' extensions with a jump in curvature of push/d:
           every line crossing those rays folded there, hardest next to the
           card. The 4-norm of the same outside distances has contours that
           are rounded rectangles and a normal that turns with zero slope
           where a side ends, so the lines bend round the surface the way
           the pointer bends them, and the lift is the same lift.
           .
           The Gaussian keeps its width. The 4-norm is never longer than the
           Euclidean distance, so the cutoff above stays the Euclidean one:
           the repaint boxes were sized for it, and at 4 widths what the
           diagonal loses is a tenth of a pixel. */
        const ax2 = dx * dx;
        const ay2 = dy * dy;
        const q2 = Math.sqrt(ax2 * ax2 + ay2 * ay2); // squared 4-norm
        const profile = Math.exp(-q2 / (2 * rippleWidth * rippleWidth));
        const edge = profile * weight;
        selectedWave = Math.max(selectedWave, edge);
        if (d2 > 0.0001 && ripplePush) {
          const cx = ax2 * dx;
          const cy = ay2 * dy;
          const scale = edge * ripplePush / Math.sqrt(cx * cx + cy * cy);
          selectedPushX += cx * scale;
          selectedPushY += cy * scale;
        }
      }
      /* NEIGHBOURS SATURATE, THEY DO NOT CLIP. Two surfaces facing each other
         sum their pushes; clamping the sum at ripplePush put a crease where it
         crossed the limit, the rigid band between two close cards. This
         8-norm soft limit is the identity to 0.1% at half the push, 0.92 of
         it at the push, and approaches the push without ever passing it. */
      const selectedPush2 = selectedPushX * selectedPushX + selectedPushY * selectedPushY;
      if (selectedPush2 > 0 && ripplePush) {
        const s2 = selectedPush2 / (ripplePush * ripplePush);
        const s4 = s2 * s2;
        const scale = 1 / Math.sqrt(Math.sqrt(Math.sqrt(1 + s4 * s4)));
        selectedPushX *= scale;
        selectedPushY *= scale;
      }
      px += selectedPushX;
      py += selectedPushY;
      if (cursorScale > 0 && cursorWeight > 0 && focusShapeWeight < 1) {
        const dx = px - fx;
        const dy = py - fy;
        const d2 = dx * dx + dy * dy;
        if (d2 < cursorReach2) {
          /* r(1-r/R)^2 peaks at R/3. Normalising it to cursorPush leaves a
             soft zero at the hand and a zero slope at the outer boundary. */
          const edge = 1 - Math.sqrt(d2) / cursorReach;
          const scale = cursorScale * cursorWeight * (1 - focusShapeWeight) * edge * edge;
          px += dx * scale;
          py += dy * scale;
        }
      }
      const waveLift = Math.min(Math.max(wave, selectedWave), 1); // overlapping fields cannot add brightness
      let alpha = baseAlpha + (peakAlpha - baseAlpha) * t + waveLift * rippleBoost;
      /* A held area clears the dots inside it. Fade and shrink each dot by
         its final displaced centre, so none can leak across the edge. The
         footprint-light blend softens press and release; a free-ground circle
         has no shape and keeps its ordinary ripple. */
      /* Zero distance means INSIDE, including the boundary. The area stays
         clear even if its outer fade width is configured to zero. */
      const edgeTaper = shapeTaper(px, py);
      if (edgeTaper < 1) alpha *= edgeTaper;
      /* Before the threshold, not after: a dot at the bottom of its breath
         should fall out of the frame entirely rather than be drawn at an
         alpha the canvas cannot hold anyway. The dot KEEPS ITS RADIUS while
         it breathes; the carried edge taper above also changes its radius. */
      if (dip) alpha *= 1 - dip * BREATH_DEPTH;
      if (alpha < 0.012) {
        dStyle = "";
        dFabricAlpha = 0;
        dBaseFabricAlpha = 0;
        return;
      }
      if (alpha > peakAlpha) alpha = peakAlpha; // never brighter than the established peak
      /* A link belongs to the bright core, while a dot remains visible into
         the far field. Squaring the light's share removes the baseline link
         without dimming the centre or introducing a hard edge. */
      const fabricLight = Math.max(0, Math.min(1, (alpha - baseAlpha) * fabricRangeInverse));
      dBaseFabricAlpha = alpha * fabricLight * fabricLight * fabricFocus;
      dFabricAlpha = dBaseFabricAlpha;
      const warm = Math.min(1, t * tint + waveLift * tint);
      const dr = (fg[0] + (primary[0] - fg[0]) * warm) | 0;
      const dg = (fg[1] + (primary[1] - fg[1]) * warm) | 0;
      const db = (fg[2] + (primary[2] - fg[2]) * warm) | 0;
      dR = Math.min(
        dotPeak,
        dotBase + t * (dotPeak - dotBase) + waveLift * rippleGrow,
      );
      if (edgeTaper < 1) dR *= Math.sqrt(edgeTaper);
      dStyle = styleFor(dr, dg, db, alpha);
      dX = px;
      dY = py;
    };

    /** Draws cell `i` as it was last worked out. */
    const drawCell = (i: number) => {
      const s = drawnStyle[i];
      if (!s) return;
      if (s !== lastStyle) {
        ctx.fillStyle = s;
        lastStyle = s;
      }
      ctx.beginPath();
      ctx.arc(drawnX[i], drawnY[i], drawnR[i], 0, TAU);
      ctx.fill();
    };

    /** Works cell `i` out now and says whether the canvas is wrong for it. */
    const stale = (i: number) => {
      const x = cellX[i % cols];
      const y = cellY[(i / cols) | 0];
      evalDot(x, y, focusAt(x, y), breathDip(i));
      const was = drawnStyle[i];
      if (
        was === dStyle &&
        (dStyle === "" ||
          (drawnR[i] === dR && drawnX[i] === dX && drawnY[i] === dY))
      ) {
        if (fabricCtx && dStyle &&
          (Math.round(drawnFabricAlpha[i] * 255) !== Math.round(dFabricAlpha * 255) ||
            Math.round(drawnBaseFabricAlpha[i] * 255) !== Math.round(dBaseFabricAlpha * 255))
        ) fabricDirty[fabricDirtyCount++] = i;
        drawnFabricAlpha[i] = dFabricAlpha;
        drawnBaseFabricAlpha[i] = dBaseFabricAlpha;
        return false;
      }
      if (fabricCtx && (
        Boolean(was) !== Boolean(dStyle) ||
        (Boolean(dStyle) && (
          drawnX[i] !== dX || drawnY[i] !== dY ||
          Math.round(drawnFabricAlpha[i] * 255) !== Math.round(dFabricAlpha * 255) ||
          Math.round(drawnBaseFabricAlpha[i] * 255) !== Math.round(dBaseFabricAlpha * 255) ||
          Math.round(7 * (drawnR[i] - dotBase) / (dotPeak - dotBase)) !==
            Math.round(7 * (dR - dotBase) / (dotPeak - dotBase))
        ))
      )) fabricDirty[fabricDirtyCount++] = i;
      oldVisible[i] = was ? 1 : 0;
      oldR[i] = drawnR[i];
      oldX[i] = drawnX[i];
      oldY[i] = drawnY[i];
      drawnStyle[i] = dStyle;
      drawnR[i] = dR;
      drawnX[i] = dX;
      drawnY[i] = dY;
      drawnFabricAlpha[i] = dFabricAlpha;
      drawnBaseFabricAlpha[i] = dBaseFabricAlpha;
      return true;
    };

    /** A displaced circle can cross its grid cell at large ripple settings.
        Clear every tile touched by its OLD and NEW circles, then clip the
        redraw to that same union. The clip lets neighbouring cached dots be
        repainted without darkening their pixels outside the cleared area. */
    const repaintDirty = (n: number) => {
      if (!n) return;
      let count = 0;
      let minCol = cols, minRow = rows, maxCol = -1, maxRow = -1;
      const markCircle = (x: number, y: number, radius: number) => {
        /* One CSS pixel covers the rasteriser's fringe at every capped DPR.
           The tile itself is only a damage unit, never a glyph clipping box. */
        const extent = radius + 1;
        const c0 = Math.max(0, Math.floor((x - extent - gridX) / step));
        const r0 = Math.max(0, Math.floor((y - extent - gridY) / step));
        const c1 = Math.min(cols - 1, Math.floor((x + extent - gridX) / step));
        const r1 = Math.min(rows - 1, Math.floor((y + extent - gridY) / step));
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
          const cell = r * cols + c;
          if (damage[cell]) continue;
          damage[cell] = 1;
          damageCells[count++] = cell;
          minCol = Math.min(minCol, c);
          minRow = Math.min(minRow, r);
          maxCol = Math.max(maxCol, c);
          maxRow = Math.max(maxRow, r);
        }
      };
      for (let k = 0; k < n; k++) {
        const i = dirty[k];
        if (oldVisible[i]) markCircle(oldX[i], oldY[i], oldR[i]);
        if (drawnStyle[i]) markCircle(drawnX[i], drawnY[i], drawnR[i]);
      }
      if (!count) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const clip = new Path2D();
      for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol;) {
          if (!damage[r * cols + c]) { c++; continue; }
          const start = c++;
          while (c <= maxCol && damage[r * cols + c]) c++;
          const x0 = Math.floor((gridX + start * step) * dpr);
          const y0 = Math.floor((gridY + r * step) * dpr);
          const x1 = Math.ceil((gridX + c * step) * dpr);
          const y1 = Math.ceil((gridY + (r + 1) * step) * dpr);
          ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
          clip.rect(x0, y0, x1 - x0, y1 - y0);
        }
      }
      ctx.clip(clip);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      /* Five crests can each push a dot, and the selected rim and hand can
         push once more. Search original centres only where a drawn circle
         could reach this damage; the exact tile test below rejects the rest. */
      const reach = 6 * Math.abs(ripplePush) + Math.max(0, cursorPush) + dotPeak + 1;
      const c0 = Math.max(0, Math.floor((minCol * step - reach) / step));
      const r0 = Math.max(0, Math.floor((minRow * step - reach) / step));
      const c1 = Math.min(cols, Math.ceil(((maxCol + 1) * step + reach) / step));
      const r1 = Math.min(rows, Math.ceil(((maxRow + 1) * step + reach) / step));
      lastStyle = "";
      for (let r = r0; r < r1; r++) for (let c = c0, i = r * cols + c0; c < c1; c++, i++) {
        if (!drawnStyle[i]) continue;
        const extent = drawnR[i] + 1;
        const dc0 = Math.max(0, Math.floor((drawnX[i] - extent - gridX) / step));
        const dr0 = Math.max(0, Math.floor((drawnY[i] - extent - gridY) / step));
        const dc1 = Math.min(cols - 1, Math.floor((drawnX[i] + extent - gridX) / step));
        const dr1 = Math.min(rows - 1, Math.floor((drawnY[i] + extent - gridY) / step));
        let intersects = false;
        for (let dr = dr0; dr <= dr1 && !intersects; dr++) for (let dc = dc0; dc <= dc1; dc++) {
          if (damage[dr * cols + dc]) { intersects = true; break; }
        }
        if (intersects) drawCell(i);
      }
      ctx.restore();
      lastStyle = "";
      for (let k = 0; k < count; k++) damage[damageCells[k]] = 0;
    };

    /* Links live on their own canvas. A dot's cleared cell cannot eat a link,
       and repainting a link cannot darken a dot. Clip each update at device
       pixel boundaries, then include every edge that can cross that box:
       five simultaneous crests can each push an endpoint by `ripplePush`. */
    const repaintFabric = (x0: number, y0: number, x1: number, y1: number) => {
      if (!fabricCtx || x1 <= x0 || y1 <= y0) return;
      const left = Math.max(0, Math.floor(x0 * dpr));
      const top = Math.max(0, Math.floor(y0 * dpr));
      const right = Math.min(fabric!.width, Math.ceil(x1 * dpr));
      const bottom = Math.min(fabric!.height, Math.ceil(y1 * dpr));
      if (right <= left || bottom <= top) return;
      fabricCtx.save();
      fabricCtx.setTransform(1, 0, 0, 1, 0, 0);
      fabricCtx.clearRect(left, top, right - left, bottom - top);
      fabricCtx.beginPath();
      fabricCtx.rect(left, top, right - left, bottom - top);
      fabricCtx.clip();
      fabricCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      /* The carried surface must stay empty even when a short link crosses
         it with both endpoints outside. Its soft edge still comes from the
         same taper that shrinks the dots, sampled along the stroke below. */
      if (focusShapes && focusShapeWeight >= 1 - 1e-6) for (const shape of focusShapes) {
        fabricCtx.beginPath();
        fabricCtx.rect(0, 0, width, height);
        fabricCtx.rect(shape.left, shape.top, shape.right - shape.left, shape.bottom - shape.top);
        fabricCtx.clip("evenodd");
      }
      fabricCtx.lineCap = "round";
      /* Two neighbouring dots determine each edge's tangent. Cover their
         displacement as well as the edge itself in a clipped repaint. */
      const bendReach = 6 * Math.abs(ripplePush) + Math.max(0, cursorPush);
      const reach = 2 * step + 2 * bendReach + 2;
      const c0 = Math.max(0, Math.floor((x0 - reach - gridX) / step));
      const r0 = Math.max(0, Math.floor((y0 - reach - gridY) / step));
      const c1 = Math.min(cols, Math.ceil((x1 + reach - gridX) / step));
      const r1 = Math.min(rows, Math.ceil((y1 + reach - gridY) / step));
      const clipX0 = left / dpr;
      const clipY0 = top / dpr;
      const clipX1 = right / dpr;
      const clipY1 = bottom / dpr;
      /* A stroke per link turns six thousand faint hairs into six thousand
         rasteriser setups. Alpha follows the canvas's own 8-bit coverage;
         width has eight steps across only 0.16 CSS pixel. Batch matching
         hairs into paths, then composite each path once. */
      const paths: (Path2D | undefined)[] = [];
      const pathKeys: number[] = [];
      const touchesShape = (left: number, top: number, right: number, bottom: number, shape: Footprint) =>
        right >= shape.left - edgeWidth - step &&
        left <= shape.right + edgeWidth + step &&
        bottom >= shape.top - edgeWidth - step &&
        top <= shape.bottom + edgeWidth + step;
      let pointX = 0, pointY = 0;
      const curvePoint = (ax: number, ay: number, c1x: number, c1y: number,
        c2x: number, c2y: number, bx: number, by: number, t: number) => {
        const u = 1 - t;
        pointX = u * u * u * ax + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * bx;
        pointY = u * u * u * ay + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * by;
      };
      let tangentX = 0, tangentY = 0;
      const curveTangent = (ax: number, ay: number, c1x: number, c1y: number,
        c2x: number, c2y: number, bx: number, by: number, t: number) => {
        const u = 1 - t;
        tangentX = 3 * (u * u * (c1x - ax) + 2 * u * t * (c2x - c1x) + t * t * (bx - c2x));
        tangentY = 3 * (u * u * (c1y - ay) + 2 * u * t * (c2y - c1y) + t * t * (by - c2y));
      };
      const drawLink = (a: number, b: number) => {
        if (!drawnStyle[a] || !drawnStyle[b]) return;
        const ax = drawnX[a], ay = drawnY[a];
        const bx = drawnX[b], by = drawnY[b];
        if (Math.max(ax, bx) + step + bendReach < clipX0 - 1 || Math.min(ax, bx) - step - bendReach > clipX1 + 1 ||
            Math.max(ay, by) + step + bendReach < clipY0 - 1 || Math.min(ay, by) - step - bendReach > clipY1 + 1) return;
        const alpha = Math.sqrt(drawnFabricAlpha[a] * drawnFabricAlpha[b]) * 0.42;
        /* The edge taper can only DIM this link. Reject a subvisible
           alpha before testing rectangles and constructing its path: most
           pairs beyond the 300px line light still have visible dots. */
        if (alpha < 0.002) return;
        const horizontal = b === a + 1;
        const before = a - (horizontal ? 1 : cols);
        const after = b + (horizontal ? 1 : cols);
        const hasBefore = horizontal ? a % cols > 0 : before >= 0;
        const hasAfter = horizontal ? b % cols + 1 < cols : after < cols * rows;
        /* Catmull-Rom tangents use ONLY the grid's already displaced dots.
           A hidden neighbour cannot steer a visible rim, so its tangent
           continues the visible edge. This keeps a flat mesh exactly flat. */
        const lx = hasBefore && drawnStyle[before] ? drawnX[before] : 2 * ax - bx;
        const ly = hasBefore && drawnStyle[before] ? drawnY[before] : 2 * ay - by;
        const rx = hasAfter && drawnStyle[after] ? drawnX[after] : 2 * bx - ax;
        const ry = hasAfter && drawnStyle[after] ? drawnY[after] : 2 * by - ay;
        let t1x = (bx - lx) * 0.5, t1y = (by - ly) * 0.5;
        let t2x = (rx - ax) * 0.5, t2y = (ry - ay) * 0.5;
        const chordX = bx - ax, chordY = by - ay;
        const maxTangent2 = 2.25 * Math.max(step * step, chordX * chordX + chordY * chordY);
        const t1Length2 = t1x * t1x + t1y * t1y;
        const t2Length2 = t2x * t2x + t2y * t2y;
        if (t1Length2 > maxTangent2) {
          const scale = Math.sqrt(maxTangent2 / t1Length2);
          t1x *= scale; t1y *= scale;
        }
        if (t2Length2 > maxTangent2) {
          const scale = Math.sqrt(maxTangent2 / t2Length2);
          t2x *= scale; t2y *= scale;
        }
        const c1x = ax + t1x / 3, c1y = ay + t1y / 3;
        const c2x = bx - t2x / 3, c2y = by - t2y / 3;
        const curveLeft = Math.min(ax, bx, c1x, c2x), curveTop = Math.min(ay, by, c1y, c2y);
        const curveRight = Math.max(ax, bx, c1x, c2x), curveBottom = Math.max(ay, by, c1y, c2y);
        if (curveRight < clipX0 - 1 || curveLeft > clipX1 + 1 ||
            curveBottom < clipY0 - 1 || curveTop > clipY1 + 1) return;
        const radius = (drawnR[a] + drawnR[b]) * 0.5;
        const widthStep = Math.round(7 * Math.max(0, Math.min(1, (radius - dotBase) / (dotPeak - dotBase))));
        /* Away from a carried edge the full link is a single hairline. Near
           it, short spans let the taper follow the rectangle rather than
           bridging its fade with one midpoint sample. */
        let nearShape = false;
        if (focusShapes && focusShapeWeight > 0) for (const shape of focusShapes) {
          if (touchesShape(curveLeft, curveTop, curveRight, curveBottom, shape)) { nearShape = true; break; }
        }
        curvePoint(ax, ay, c1x, c1y, c2x, c2y, bx, by, 0.5);
        if (!nearShape) for (const group of candidatesAt(pointX, pointY)) for (const field of group) {
          if (sourceWeight(field) > 0 && touchesShape(curveLeft, curveTop, curveRight, curveBottom, field)) { nearShape = true; break; }
        }
        const bent = Math.abs(c1x - (2 * ax + bx) / 3) + Math.abs(c1y - (2 * ay + by) / 3) +
          Math.abs(c2x - (ax + 2 * bx) / 3) + Math.abs(c2y - (ay + 2 * by) / 3) > 0.001;
        const steps = nearShape ? Math.max(1, Math.ceil((Math.hypot(chordX, chordY) +
          Math.abs(c1x - (2 * ax + bx) / 3) + Math.abs(c1y - (2 * ay + by) / 3) +
          Math.abs(c2x - (ax + 2 * bx) / 3) + Math.abs(c2y - (ay + 2 * by) / 3)) / 5)) : 1;
        for (let s = 0; s < steps; s++) {
          const t0 = s / steps;
          const t1 = (s + 1) / steps;
          curvePoint(ax, ay, c1x, c1y, c2x, c2y, bx, by, t0);
          const sx = pointX, sy = pointY;
          curvePoint(ax, ay, c1x, c1y, c2x, c2y, bx, by, t1);
          const ex = pointX, ey = pointY;
          if (nearShape) curvePoint(ax, ay, c1x, c1y, c2x, c2y, bx, by, (t0 + t1) * 0.5);
          const sampleX = pointX, sampleY = pointY;
          const taper = nearShape ? shapeTaper(sampleX, sampleY) : 1;
          const strokeAlpha = alpha * taper;
          if (strokeAlpha < 0.002) continue;
          const alphaByte = Math.max(1, Math.min(255, Math.round(strokeAlpha * 255)));
          const key = widthStep * 256 + alphaByte;
          let path = paths[key];
          if (!path) {
            path = new Path2D();
            paths[key] = path;
            pathKeys.push(key);
          }
          path.moveTo(sx, sy);
          if (bent) {
            const dt = (t1 - t0) / 3;
            curveTangent(ax, ay, c1x, c1y, c2x, c2y, bx, by, t0);
            const segmentC1X = sx + dt * tangentX, segmentC1Y = sy + dt * tangentY;
            curveTangent(ax, ay, c1x, c1y, c2x, c2y, bx, by, t1);
            path.bezierCurveTo(segmentC1X, segmentC1Y, ex - dt * tangentX, ey - dt * tangentY, ex, ey);
          } else path.lineTo(ex, ey);
        }
      };
      for (let r = r0; r < r1; r++) {
        for (let c = c0, i = r * cols + c0; c < c1; c++, i++) {
          if (c + 1 < cols) drawLink(i, i + 1);
          if (r + 1 < rows) drawLink(i, i + cols);
        }
      }
      for (const key of pathKeys) {
        fabricCtx.lineWidth = 0.42 + 0.16 * Math.floor(key / 256) / 7;
        fabricCtx.strokeStyle = styleFor(fg[0], fg[1], fg[2], (key % 256) / 255);
        fabricCtx.stroke(paths[key]!);
      }
      fabricCtx.restore();
    };

    /** Repaint links that touch changed endpoints, plus the old and new
        carried edge. The spotlight's sweep can span most of the workspace
        while only a much smaller set of dots actually changes. */
    const repaintChangedFabric = () => {
      if (!fabricCtx) return;
      if (fabricRecolor) {
        repaintFabric(0, 0, width, height);
        fabricRecolor = false;
        lastFabricShapes = focusShapes?.map(shape => ({ ...shape })) ?? [];
        lastFabricWeight = focusShapeWeight;
        lastFabricFields = fabricFieldSnapshot();
        return;
      }
      let x0 = width, y0 = height, x1 = 0, y1 = 0;
      const pad = 2 * step + 2 * (6 * Math.abs(ripplePush) + Math.max(0, cursorPush)) + 2;
      const include = (left: number, top: number, right: number, bottom: number) => {
        x0 = Math.min(x0, left - pad);
        y0 = Math.min(y0, top - pad);
        x1 = Math.max(x1, right + pad);
        y1 = Math.max(y1, bottom + pad);
      };
      for (let k = 0; k < fabricDirtyCount; k++) {
        const i = fabricDirty[k];
        const x = cellX[i % cols];
        const y = cellY[(i / cols) | 0];
        include(x, y, x, y);
      }
      const shapeChanged = lastFabricWeight !== focusShapeWeight ||
        lastFabricShapes.length !== (focusShapes?.length ?? 0) ||
        lastFabricShapes.some((shape, i) => {
          const next = focusShapes?.[i];
          return !next || shape.left !== next.left || shape.top !== next.top ||
            shape.right !== next.right || shape.bottom !== next.bottom;
        });
      if (shapeChanged) {
        const shapePad = edgeWidth + step;
        for (let i = 0; i < Math.max(lastFabricShapes.length, focusShapes?.length ?? 0); i++) {
          const before = lastFabricWeight > 0 ? lastFabricShapes[i] : undefined;
          const after = focusShapeWeight > 0 ? focusShapes?.[i] : undefined;
          if (before && after && before.left <= after.right && before.right >= after.left &&
              before.top <= after.bottom && before.bottom >= after.top) {
            repaintFabric(Math.min(before.left, after.left) - shapePad, Math.min(before.top, after.top) - shapePad,
              Math.max(before.right, after.right) + shapePad, Math.max(before.bottom, after.bottom) + shapePad);
          } else {
            if (before) repaintFabric(before.left - shapePad, before.top - shapePad, before.right + shapePad, before.bottom + shapePad);
            if (after) repaintFabric(after.left - shapePad, after.top - shapePad, after.right + shapePad, after.bottom + shapePad);
          }
        }
      }
      if (x1 > x0 && y1 > y0) repaintFabric(x0, y0, x1, y1);
      if (lastFabricFields.length || lineFields.length) {
        const currentFields = fabricFieldSnapshot();
        const changedFields = new Map<string, { old?: { rect: Footprint; weight: number }; next?: { rect: Footprint; weight: number } }>();
        for (const field of lastFabricFields) changedFields.set(field.id, { old: field });
        for (const field of currentFields) {
          const pair = changedFields.get(field.id) ?? {};
          pair.next = field;
          changedFields.set(field.id, pair);
        }
        for (const { old, next } of changedFields.values()) {
          if (old?.weight === next?.weight && old?.rect.left === next?.rect.left && old?.rect.top === next?.rect.top &&
              old?.rect.right === next?.rect.right && old?.rect.bottom === next?.rect.bottom) continue;
          const shapePad = edgeWidth + step + 2;
          const before = old && old.weight > 0 ? old.rect : undefined;
          const after = next && next.weight > 0 ? next.rect : undefined;
          /* Easing changes a scene field's weight every frame without
             moving its rectangle. Clearing and rebuilding those same links
             twice makes the second pass repeat the entire first pass. */
          if (before && after && before.left <= after.right && before.right >= after.left &&
              before.top <= after.bottom && before.bottom >= after.top) {
            repaintFabric(Math.min(before.left, after.left) - shapePad, Math.min(before.top, after.top) - shapePad,
              Math.max(before.right, after.right) + shapePad, Math.max(before.bottom, after.bottom) + shapePad);
          } else {
            if (before) repaintFabric(before.left - shapePad, before.top - shapePad, before.right + shapePad, before.bottom + shapePad);
            if (after) repaintFabric(after.left - shapePad, after.top - shapePad, after.right + shapePad, after.bottom + shapePad);
          }
        }
        lastFabricFields = currentFields;
      }
      lastFabricShapes = focusShapes?.map(shape => ({ ...shape })) ?? [];
      lastFabricWeight = focusShapeWeight;
    };

    /** Every cell whose centre is inside the rectangle, worked out now and
        repainted where it changed. The rectangle's edges are on the midlines
        between dots , see `snap`. */
    const sweep = (x0: number, y0: number, x1: number, y1: number) => {
      paints++;
      prepareRipples();
      /* An edge clamped to the canvas is not a midline once the grid is
         panned; the first column then starts at 0 rather than rounding past
         a cell whose dot straddles the edge. */
      const c0 = x0 <= 0 ? 0 : Math.round((x0 - gridX) / step);
      const r0 = y0 <= 0 ? 0 : Math.round((y0 - gridY) / step);
      const c1 = Math.min(cols, Math.ceil((Math.min(x1, width) - gridX - step / 2) / step));
      const r1 = Math.min(rows, Math.ceil((Math.min(y1, height) - gridY - step / 2) / step));
      let n = 0;
      fabricDirtyCount = 0;
      for (let r = r0; r < r1; r++) {
        for (let i = r * cols + c0, end = r * cols + c1; i < end; i++) {
          if (stale(i)) dirty[n++] = i;
        }
      }
      repaintDirty(n);
      repaintChangedFabric();
    };

    /** Every dot, from scratch: `still`, reduced motion, a resize, a theme
        change seen with no loop running. Everything else goes through
        `sweep`, which draws the same picture by drawing only its changes. */
    const render = () => {
      paints++;
      ctx.clearRect(0, 0, width, height);
      prepareRipples();
      fabricDirtyCount = 0;
      for (let i = 0, n = cols * rows; i < n; i++) {
        stale(i);
        drawCell(i);
      }
      repaintFabric(0, 0, width, height);
      fabricRecolor = false;
      lastFabricShapes = focusShapes?.map(shape => ({ ...shape })) ?? [];
      lastFabricWeight = focusShapeWeight;
      lastFabricFields = fabricFieldSnapshot();
      prevBox = null; // the canvas is now correct everywhere
      prevRippleBoxes = [];
      prevHeldBoxes = [];
      prevSelectionBoxes = selectionBoxes();
    };

    /* ═══ THE BOX EDGE FALLS BETWEEN TWO COLUMNS OF DOTS, NEVER THROUGH ONE
       .
       The repainted region gets cleared and then filled back in dot by dot,
       and the dots it fills back in are the ones whose CENTRE is inside it. An
       edge landing near a dot therefore erases the sliver of that dot which
       reaches across it and never puts it back , a one-pixel frame of
       half-eaten dots trailing the light, which is exactly what the parity
       harness caught the first time.
       .
       Dot centres sit at `grid + step/2 + k·step`, so the midlines between
       them are `grid + k·step`. Snapping every edge to those leaves `step/2`
       of daylight , eleven pixels at rest, for a dot 1.6px across , and
       straddling stops being a case to handle rather than being handled. */
    const snap = (v: number, up: boolean, max: number, origin: number) => {
      const q = origin + (up ? Math.ceil((v - origin) / step) : Math.floor((v - origin) / step)) * step;
      return q < 0 ? 0 : q > max ? max : q;
    };
    const paintRegions = (regions: Footprint[]) => {
      for (let i = 0; i < regions.length; i++) {
        const region = regions[i];
        if (region.right <= region.left || region.bottom <= region.top) continue;
        for (let j = i + 1; j < regions.length;) {
          const other = regions[j];
          if (other.left <= region.right && other.right >= region.left &&
              other.top <= region.bottom && other.bottom >= region.top) {
            region.left = Math.min(region.left, other.left);
            region.top = Math.min(region.top, other.top);
            region.right = Math.max(region.right, other.right);
            region.bottom = Math.max(region.bottom, other.bottom);
            regions.splice(j, 1);
            j = i + 1;
          } else j++;
        }
        sweep(region.left, region.top, region.right, region.bottom);
      }
    };
    const snappedBox = (left: number, top: number, right: number, bottom: number, pad: number): Footprint => ({
      left: snap(left - pad, false, width, gridX), top: snap(top - pad, false, height, gridY),
      right: snap(right + pad, true, width, gridX), bottom: snap(bottom + pad, true, height, gridY),
    });

    /** The light's frame. Only the box the light left plus the box it entered
        is looked at; everywhere else the canvas already holds the right
        picture from the previous frame and is left alone.
        .
        NOTHING IS CACHED INTO AN OFFSCREEN CANVAS TO MAKE THIS WORK, and that
        is deliberate. Blitting a pre-rendered far field was tried first and it
        is wrong here: at `baseAlpha` 0.02 a dot is 5/255, so a round trip
        through an 8-bit buffer quantises the antialiased edge twice and the
        faint half of every dot rounds away , 20,000 changed pixels and a mean
        alpha drifted upward, measured. Batching the far dots into one path
        instead of one fill each is faster still and also wrong, for the same
        kind of reason: Skia rasterises a path of 2,400 circles differently
        from 2,400 circles, and the difference lands on a fifth of the grain.
        Redrawing fewer dots with the untouched per-dot code is the only one of
        the three that is the same picture. */
    const renderMoving = () => {
      prepareRipples();
      const pad = focusRadius + dotPeak + 1;
      const bx0 = snap(fx - pad, false, width, gridX);
      const by0 = snap(fy - pad, false, height, gridY);
      const bx1 = snap(fx + pad, true, width, gridX);
      const by1 = snap(fy + pad, true, height, gridY);

      const held = focusShapes?.map(fieldBox) ?? [];
      if (!activeFields.length && !prevSelectionBoxes.length && !prevRippleBoxes.length && !prevHeldBoxes.length && !held.length) {
        const ux0 = prevBox ? Math.min(prevBox[0], bx0) : 0;
        const uy0 = prevBox ? Math.min(prevBox[1], by0) : 0;
        const ux1 = prevBox ? Math.max(prevBox[2], bx1) : width;
        const uy1 = prevBox ? Math.max(prevBox[3], by1) : height;
        prevBox = [bx0, by0, bx1, by1];
        if (ux1 > ux0 && uy1 > uy0) sweep(ux0, uy0, ux1, uy1);
        return;
      }
      const fields = selectionBoxes();
      if (!prevBox) {
        prevBox = [bx0, by0, bx1, by1];
        prevSelectionBoxes = fields;
        prevHeldBoxes = held;
        sweep(0, 0, width, height);
        return;
      }
      const regions: Footprint[] = [
        { left: Math.min(prevBox[0], bx0), top: Math.min(prevBox[1], by0), right: Math.max(prevBox[2], bx1), bottom: Math.max(prevBox[3], by1) },
        ...prevRippleBoxes.map(box => ({ ...box })),
        ...prevHeldBoxes.map(box => ({ ...box })),
        ...held.map(box => ({ ...box })),
        ...prevSelectionBoxes.map(box => ({ ...box })), ...fields.map(box => ({ ...box })),
      ];
      prevBox = [bx0, by0, bx1, by1];
      prevRippleBoxes = [];
      prevHeldBoxes = held;
      prevSelectionBoxes = fields;
      /* Keep distant scene fields as separate paint regions. A rectangle
         spanning both would make a pointer near one repaint the empty space
         between them on every easing frame. */
      paintRegions(regions);
    };

    /* What a held frame's picture was worked out FROM, beyond the pointer.
       `paints` counts every paint of any kind, so a snapshot is only trusted
       by the next held frame when nothing else has drawn in between. */
    let paints = 0;
    type HeldSignature = {
      shapes: Footprint[] | undefined;
      weight: number;
      ids: readonly string[] | undefined;
      rings: { footprints: Footprint[] | undefined; x: number; y: number; radius: number; amp: number }[];
      colour: number[];
      animated: boolean;
    };
    let heldPainted: (HeldSignature & { paints: number }) | null = null;
    const heldSignature = (): HeldSignature => {
      const rings: HeldSignature["rings"] = [];
      for (let i = 0; i < preparedCount; i++) {
        const rp = preparedRipples[i];
        rings.push({ footprints: rp.footprints, x: rp.x, y: rp.y, radius: rp.radius, amp: rp.amp });
      }
      return {
        shapes: focusShapes,
        weight: focusShapeWeight,
        ids: press?.ring?.ids,
        rings,
        colour: [fg[0], fg[1], fg[2], primary[0], primary[1], primary[2], baseAlpha, peakAlpha],
        animated: breathIdx.length > 0 || Boolean(tintHueVar && hueMoving),
      };
    };
    const sameHeld = (a: HeldSignature, b: HeldSignature) =>
      !a.animated && !b.animated &&
      a.shapes === b.shapes && a.weight === b.weight && a.ids === b.ids &&
      a.rings.length === b.rings.length &&
      a.rings.every((ring, i) => {
        const other = b.rings[i];
        /* A ring with a footprint measures from the rectangle and never reads
           its own centre (`evalDot`), which follows the pointer. */
        return ring.footprints === other.footprints && ring.radius === other.radius && ring.amp === other.amp &&
          (ring.footprints ? true : ring.x === other.x && ring.y === other.y);
      }) &&
      a.colour.every((v, i) => v === b.colour[i]);

    /* `evalDot` discards crest influence below 0.002. Four Gaussian widths
       are already below that threshold even at maximum amplitude, so a held
       crest cannot change a cell beyond this box. Include its previous box
       and both spotlight boxes to clear every dot the pointer left behind. */
    const renderHeld = () => {
      prepareRipples();
      const crestPad = RIPPLE_RISE_MS * rippleSpeed + 4 * Math.abs(rippleWidth) + Math.abs(ripplePush) + dotPeak;
      if (!Number.isFinite(crestPad) || crestPad < 0) {
        sweep(0, 0, width, height);
        prevBox = null;
        prevHeldBoxes = [];
        heldPainted = null;
        return;
      }
      /* ═══ A HELD FRAME REPAINTS WHAT CAN HAVE CHANGED, AND NOTHING ELSE ════
         .
         Measured on a resize (`docs/audits/2026-09-25-resize-cpu-profile.md`
         #6): this frame swept the light's box, the held surface's field box
         and its crest on EVERY vsync, and at a light radius of 600 their
         union is most of the canvas, worked out dot by dot at 120 Hz while the
         footprint it describes moves at the hand's 60.
         .
         Two of those boxes are provably the picture already on the canvas:
         .
         THE HELD SURFACE, while nothing that shapes it moved since the last
         held frame painted it: the same footprint objects (`onFootprint`
         keeps them while equal), the same weight, the same carried ids, the
         same rings and the same colours. `sweep` would work every dot out
         again and find none stale.
         .
         THE LIGHT, once the surface is at full weight now AND was at the last
         paint. At weight 1 `focusAt` gives the pointer's light `1 − w = 0`
         and the cursor push is gated off, so where the hand is changes no
         dot; and the frame that reached 1 had already swept the light out.
         .
         ANY OTHER PAINT IN BETWEEN VOIDS BOTH (`paints`), and so does a
         breath or a turning hue: those change dots under the held boxes with
         time, and today's sweep is what carries them there. */
      const signature = heldSignature();
      const kept = heldPainted !== null && heldPainted.paints === paints && sameHeld(heldPainted, signature);
      const dark = kept && focusShapeWeight === 1;
      const cursor = snappedBox(fx, fy, fx, fy, focusRadius + dotPeak + 1);
      const currentHeld = focusShapes?.map(fieldBox) ?? [];
      const crests: Footprint[] = [];
      for (const rp of ripples) {
        const pad = rp.footprints
          ? 4 * Math.abs(rippleWidth) + Math.abs(ripplePush) + dotPeak : crestPad;
        if (rp.footprints) {
          for (const shape of rp.footprints) crests.push(snappedBox(shape.left, shape.top, shape.right, shape.bottom, pad));
        } else crests.push(snappedBox(rp.x, rp.y, rp.x, rp.y, pad));
      }
      const fields = selectionBoxes();
      if (!prevBox) {
        sweep(0, 0, width, height);
      } else {
        paintRegions([
          ...(dark ? [] : [{ left: prevBox[0], top: prevBox[1], right: prevBox[2], bottom: prevBox[3] }, cursor]),
          ...(kept ? [] : [
            ...prevHeldBoxes.map(box => ({ ...box })), ...currentHeld.map(box => ({ ...box })),
            ...prevRippleBoxes.map(box => ({ ...box })), ...crests,
          ]),
          ...prevSelectionBoxes.map(box => ({ ...box })), ...fields.map(box => ({ ...box })),
        ]);
      }
      prevBox = [cursor.left, cursor.top, cursor.right, cursor.bottom];
      prevHeldBoxes = currentHeld;
      prevRippleBoxes = crests;
      prevSelectionBoxes = fields;
      heldPainted = { ...signature, paints };
    };

    /* Each moved surface has its own wave support. Keep old and new regions
       separate so the empty gap between selected surfaces is not repainted. */
    const renderTravelling = () => {
      prepareRipples();
      const cursor = snappedBox(fx, fy, fx, fy, focusRadius + dotPeak + 1);
      const support = 4 * Math.abs(rippleWidth) + step + 5 * Math.abs(ripplePush) + dotPeak + 2;
      const crests: Footprint[] = [];
      for (const rp of ripples) {
        const age = now - rp.start;
        if (age < 0) continue;
        const waveAge = rp.held ? RIPPLE_RISE_MS : age;
        const radius = rp.footprints ? Math.max(0, waveAge - RIPPLE_RISE_MS) * rippleSpeed : waveAge * rippleSpeed;
        const pad = radius + support;
        if (rp.footprints) {
          for (const shape of rp.footprints) crests.push(snappedBox(shape.left, shape.top, shape.right, shape.bottom, pad));
        } else crests.push(snappedBox(rp.x, rp.y, rp.x, rp.y, pad));
      }
      const held = focusShapes?.map(fieldBox) ?? [];
      const fields = selectionBoxes();
      if (!prevBox) {
        sweep(0, 0, width, height);
      } else {
        paintRegions([
          { left: prevBox[0], top: prevBox[1], right: prevBox[2], bottom: prevBox[3] }, cursor,
          ...prevRippleBoxes.map(box => ({ ...box })), ...crests,
          ...prevHeldBoxes.map(box => ({ ...box })), ...held.map(box => ({ ...box })),
          ...prevSelectionBoxes.map(box => ({ ...box })), ...fields.map(box => ({ ...box })),
        ]);
      }
      prevBox = [cursor.left, cursor.top, cursor.right, cursor.bottom];
      prevRippleBoxes = crests;
      prevHeldBoxes = held;
      prevSelectionBoxes = fields;
    };

    /** The grid, walked once per resize: where every dot sits, which ones
        breathe and how. `fresh` is a canvas that was just cleared, so there
        is nothing on it to compare with; otherwise a grid of the same shape
        keeps what it knows was drawn. */
    const layoutCells = (fresh: boolean) => {
      const half = step / 2;
      let nc = 0;
      let nr = 0;
      for (let x = gridX + half; x < width; x += step) nc++;
      for (let y = gridY + half; y < height; y += step) nr++;
      const same = nc === cols && nr === rows;
      cols = nc;
      rows = nr;
      const n = cols * rows;
      /* ACCUMULATED, NOT MULTIPLIED, because this is how the loops that used
         to walk the grid arrived at each centre , for an integer `gap` the
         two agree, and for any other they now agree with the history. */
      if (cellX.length !== cols) cellX = new Float64Array(cols);
      if (cellY.length !== rows) cellY = new Float64Array(rows);
      for (let c = 0, x = gridX + half; c < cols; c++, x += step) cellX[c] = x;
      for (let r = 0, y = gridY + half; r < rows; r++, y += step) cellY[r] = y;
      /* A PAN RELAYS THE GRID EVERY FRAME, so a grid of the same shape keeps
         its buffers and is only rewritten: a new set of fourteen arrays per
         frame would be the garbage this file spent a year taking out. */
      if (same && breathOn.length === n) {
        breathOn.fill(0);
      } else {
        breathOn = new Uint8Array(n);
        breathPeriod = new Float64Array(n);
        breathPhase = new Float64Array(n);
        breathList = new Int32Array(n);
      }
      /* A dot's breath is hashed from its FLOOR index, so the dot you were
         watching keeps its period and phase while the camera pans and zooms:
         every camera change maps dots to dots (see `advanceLattice`). At rest
         the floor index is the cell index, and the field breathes exactly as
         it always did. */
      const { firstCol, firstRow } = lattice;
      let count = 0;
      for (let row = 0; row < rows; row++) {
        const worldRow = firstRow + row;
        for (let col = 0; col < cols; col++) {
          const i = row * cols + col;
          if (!breathes) continue;
          const worldCol = firstCol + col;
          if (hash(worldCol, worldRow, 1) >= density) continue;
          breathOn[i] = 1;
          /* `rate` is the caller's whole-field multiplier , see the prop.
             It divides the period, so 2 is twice as fast and every dot
             keeps its own spread and its own phase. */
          breathPeriod[i] = (BREATH_MIN + hash(worldCol, worldRow, 2) * BREATH_SPAN) / rate;
          breathPhase[i] = hash(worldCol, worldRow, 3);
          breathList[count++] = i;
        }
      }
      breathIdx = breathList.subarray(0, count);
      if (same && fresh && drawnStyle.length === n) {
        drawnStyle.fill("");
      } else if (!same || fresh) {
        drawnStyle = new Array(n).fill(fresh ? "" : null);
        drawnR = new Float64Array(n);
        drawnX = new Float64Array(n);
        drawnY = new Float64Array(n);
        oldR = new Float64Array(n);
        oldX = new Float64Array(n);
        oldY = new Float64Array(n);
        oldVisible = new Uint8Array(n);
        damage = new Uint8Array(n);
        damageCells = new Int32Array(n);
        drawnFabricAlpha = new Float64Array(n);
        drawnBaseFabricAlpha = new Float64Array(n);
        fabricDirty = new Int32Array(n);
        dirty = new Int32Array(n);
      }
    };

    /* ═══ AND THE BREATH DOES NOT COST THE FIELD ITS SLEEP ════════════════
       .
       The loop above goes down the moment the light has arrived, and that is
       not a detail , it is the difference between an ambient texture and a
       rAF running under every screen of the app for ever. A breath drawn the
       obvious way takes that away: something on the canvas is always changing,
       so the frame is always full, so three thousand dots are redrawn sixty
       times a second so that thirty of them can fade.
       .
       So the settled field does NOT redraw itself. It works out the breathing
       CELLS and repaints the ones whose dot actually came out different ,
       which, since a fade only shows when it crosses a byte of alpha, is a
       few hundred even with every dot in the field breathing.
       .
       AND IT RUNS AT 22Hz, NOT 60. This is a five-second fade on a dot 1.6px
       across; the difference between 45ms and 16ms of step is not visible on
       it, and the two thirds of the frames that are skipped are two thirds of
       the cost. */
    const BREATH_FRAME = 45; // ms between breath-only frames

    /* ═══ THE CAMERA MOVED, SO EVERY DOT MOVED ═══════════════════════════════
       .
       A pan shifts every cell by the same sub-cell amount and a zoom changes
       the spacing, so no part of the canvas is still right: this is a full
       repaint, the same one a resize pays. What keeps it affordable is WHEN
       it runs. `setViewport` and the prop only record the camera; the frame
       applies the latest one, so a host that sends five camera updates in one
       frame (wheel events arrive faster than vsync) pays for one repaint, and
       React never renders for any of them. A camera update that yields the
       identical lattice costs one comparison and no paint. */
    const applyViewport = () => {
      if (!viewDirty) return false;
      viewDirty = false;
      let next: SurfaceFieldLattice;
      if (reseed) {
        next = seedLattice(gap, view);
        reseed = false;
      } else {
        const fixed = zoomFixedPoint(floorView, view);
        const anchor = pickZoomAnchor(fixed, hand, width, height);
        next = advanceLattice(lattice, gap, floorView, view, anchor);
        if (fixed) zoomWave(anchor.x, anchor.y);
      }
      floorView = view;
      floorRef.current = { gap, lattice: next, view };
      if (sameLattice(next, lattice)) return false;
      lattice = next;
      step = next.step;
      gridX = next.originX;
      gridY = next.originY;
      layoutCells(true);
      render();
      return true;
    };

    /* One ring from the zoom's anchor, at most every ZOOM_WAVE_INTERVAL_MS.
       Only where there is a light to carry it: reduced motion and `still`
       draw no rings at all, and a carrying hand has put the rings down. The
       ring slots are five (see `preparedRipples`), so a wave makes room by
       retiring the oldest WAVE, then the oldest free ring, and never a held
       one: a press under the hand outranks the camera. */
    const zoomWave = (x: number, y: number) => {
      if (!animating || carrying) return;
      const at = now || performance.now();
      if (at - lastZoomWave < ZOOM_WAVE_INTERVAL_MS) return;
      if (ripples.length >= 5) {
        let index = ripples.findIndex(rp => rp.gain !== undefined);
        if (index < 0) index = ripples.findIndex(rp => !rp.held);
        if (index < 0) return;
        ripples.splice(index, 1);
      }
      lastZoomWave = at;
      ripples.push({ x, y, start: at, gain: ZOOM_WAVE_GAIN, life: ZOOM_WAVE_LIFE_MS });
    };

    const renderBreath = () => {
      paints++;
      /* PAST A QUARTER OF THE FIELD IT IS THE WHOLE FIELD. Walking a list of
         three thousand indices is walking the grid with extra steps, and the
         whole-grid walk is what has always happened above this share: it also
         brings every lit cell up to the same instant, which the list would
         not. */
      if (breathIdx.length * 4 > cols * rows) {
        sweep(0, 0, width, height);
        prevBox = null;
        return;
      }
      prepareRipples();
      let n = 0;
      fabricDirtyCount = 0;
      for (let k = 0; k < breathIdx.length; k++) {
        const i = breathIdx[k];
        if (stale(i)) dirty[n++] = i;
      }
      repaintDirty(n);
      repaintChangedFabric();
    };

    /**
     * Whether anything is currently TURNING the hue. Polling only while this is
     * true is the difference between a handful of reads during a hover and a
     * `getComputedStyle` every few frames for the life of the page.
     *
     * IT IS EVENT-DRIVEN AND NOT A POLL, because the read is not free: it forces
     * a synchronous style flush, and doing that from inside rAF while a custom
     * property animation is invalidating the same tree is the classic way to
     * make a page stutter. The animation events tell us exactly when there is
     * something to look at , `spectrum-hue` is the only keyframe that moves this
     * property, and CSS animation events bubble, so one listener catches a room
     * anywhere above this canvas.
     */
    let hueMoving = false;
    let hueTick = 0;

    const onHueAnimation = (e: AnimationEvent) => {
      if (e.animationName !== "spectrum-hue") return;
      if (!(e.target instanceof Node) || !e.target.contains(canvas)) return;
      hueMoving = e.type === "animationstart";
      // Read on both edges: on the way in so the first frame is already right,
      // and on the way out so the field settles on the resting hue instead of
      // keeping whatever it happened to be holding at the last poll.
      readTintHue();
    };

    const frame = (time: number) => {
      if (!running) return;
      now = time;
      advancePreview(time);
      advanceSelection(time);
      /* Before the carry check: a host may pan under a carried object, and
         the grid has to follow even while the light is asleep. */
      const moved = applyViewport();
      if (carrying) {
        if (owed) {
          sweep(0, 0, width, height);
          prevBox = null;
          owed = false;
        }
        raf = 0; // asleep until `letGo` wakes it; rings asked meanwhile wait in `pending`
        return;
      }
      drainPending();
      // Every fourth frame, and only while something is actually turning it.
      if (tintHueVar && hueMoving && (hueTick = (hueTick + 1) & 3) === 0) {
        readTintHue();
      }
      if (ripples.length) {
        const reach = Math.hypot(width, height) || 1;
        for (let i = ripples.length - 1; i >= 0; i--) {
          const rp = ripples[i];
          const travelled = rp.footprints
            ? Math.max(0, time - rp.start - RIPPLE_RISE_MS) * rippleSpeed
            : (time - rp.start) * rippleSpeed;
          if (!rp.held && (rp.life ? time - rp.start >= rp.life : travelled >= reach)) {
            ripples.splice(i, 1);
          }
        }
      }
      if (wander && focused && !pointerInside && time - lastRetarget > 2600) {
        pickTarget();
        lastRetarget = time;
      }
      const ease = pointerInside ? 0.12 : 0.02;
      fx += (tx - fx) * ease;
      fy += (ty - fy) * ease;
      const cursorTarget = cursorHovering ? 1 : 0;
      if (cursorScale > 0) {
        const elapsed = Math.max(0, time - lastCursorFrameAt);
        cursorWeight += (cursorTarget - cursorWeight) * (1 - Math.exp(-elapsed / 65));
        if (Math.abs(cursorTarget - cursorWeight) < 0.004) cursorWeight = cursorTarget;
      }
      lastCursorFrameAt = time;
      /* ARRIVED, AND NOTHING IS ASKING IT TO MOVE. The easing is asymptotic, so
         `fx` never equals `tx` and the loop would redraw an identical picture
         until the end of time. A quarter of a CSS pixel is under half of what
         the canvas can resolve at dpr 2, so snapping across it changes no pixel
         , and it is snapped BEFORE the paint, so the frame left on screen is
         the one this state describes. */
      const settled =
        !ripples.some(rp => !rp.held) &&
        !selectionTurning &&
        !previewTurning &&
        (cursorScale === 0 || cursorWeight === cursorTarget) &&
        Math.abs(tx - fx) < 0.25 &&
        Math.abs(ty - fy) < 0.25;
      if (settled) {
        fx = tx;
        fy = ty;
      }
      /* A CREST REACHES ANYWHERE AND THE LIGHT DOES NOT. While a ripple is
         alive any dot on the canvas may be lifted or shoved, so the frame is
         drawn in full; the rest of the time , nearly all of it , only the
         light's own neighbourhood is touched. */
      /* ═══ AND IT IS NOT GATED ON FOCUS, WHICH THE WANDER IS ════════════
         .
         It was, briefly, on the reasoning that an app nobody is looking at
         should cost nothing , and that reasoning is right about the WANDER
         and wrong about this. A window losing focus is not a person looking
         away: clicking another app while this one is still on screen is the
         ordinary case, and a field that freezes the moment you touch
         something else is a field caught pretending. The breath is the thing
         that says the surface is alive; it may not stop because the surface
         stopped being the active one.
         .
         SO THE BREATH NEVER LETS THE LOOP GO DOWN , but it lets it DOZE.
         A settled light with a breath on has exactly one thing left to do,
         and it is due at a time the loop already knows: `lastBreath` plus
         `BREATH_FRAME`. Every vsync in between used to be a frame that
         compared two numbers and drew nothing, and at 120Hz that is a hundred
         main-thread wakes a second for twenty that paint. See `snooze`.
         .
         `document.hidden` IS STILL A FULL STOP, and it is the gate that was
         always doing the real work. */
      const breathing = breathIdx.length > 0;
      /* A FIELD THAT BREATHES NEVER SLEEPS, so this is the `breathe = 0` case
         and the behaviour this file has always had: the light arrives and the
         loop goes down until a hand or a ring brings it back. */
      const asleep = settled && !breathing;
      if (moved) {
        /* `render` already drew this frame everywhere, light and breath. */
        lastBreath = time;
      } else if (ripples.length) {
        if (ripples.every(rp => rp.held)) {
          renderHeld();
        } else {
          renderTravelling();
        }
      } else {
        /* ═══ AND THE BREATH RIDES ON TOP OF THE CHEAP FRAME ══════════════
           .
           `renderMoving` repaints the light's neighbourhood and NOTHING ELSE,
           which is the whole reason a moving frame is affordable , and it is
           also why the breath cannot live inside it. A dot breathing on the
           far side of the canvas is never in that box, so it would hold
           whatever alpha it had when the light last went past and stay there.
           .
           So the breath is its own pass, after. A cell the light's box
           already covered is worked out a second time, comes out the same,
           and is left alone. */
        if (!settled || !resting) renderMoving();
        if (breathing && time - lastBreath >= BREATH_FRAME) {
          renderBreath();
          lastBreath = time;
        }
      }
      resting = settled;
      if (asleep) {
        raf = 0; // asleep, not stopped: `wake` picks it back up
        return;
      }
      /* NOTHING BUT THE BREATH IS LEFT TO HAPPEN when the light is at rest,
         no ring is out, and nothing will re-aim it: the wander answers to a
         focused window with no hand in it, and a hue being turned is read
         per frame. Each of those keeps the loop on every vsync. */
      if (
        settled &&
        breathing &&
        !ripples.length &&
        !pending.current.length &&
        !(wander && focused && !pointerInside) &&
        !(tintHueVar && hueMoving)
      ) {
        snooze(time);
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    /* ═══ THE BREATH'S ALARM CLOCK ═══════════════════════════════════════
       .
       The next breath frame is the first vsync at or after `lastBreath +
       BREATH_FRAME`, and that is the frame the loop still paints , so the
       picture and its timing are what they were. What goes is the frames
       before it, which drew nothing.
       .
       THE TIMER RINGS A LITTLE EARLY, on purpose: a timer is late more often
       than a vsync is, and one that rang after the due frame would paint a
       frame late. Ten milliseconds early lands it one or two vsyncs before
       the breath, whose frames find it not yet due and ask for the next one
       , the check that was always there. */
    const snooze = (time: number) => {
      raf = 0;
      const wait = lastBreath + BREATH_FRAME - time - 10;
      if (wait <= 0) {
        raf = nextFrame();
        return;
      }
      timer = window.setTimeout(ring, wait);
    };
    const ring = () => {
      timer = 0;
      if (running) raf = nextFrame();
    };

    /* ═══ AND THE TEXTURE'S OWN LOOP, WHICH IS ONLY THE BREATH ═══════════
       .
       `frame` above is the light's: it eases a focal, ages rings, decides
       whether a full or a partial repaint is owed, and goes to sleep the
       moment none of that is true. A `still` field has none of it. There is no
       focal to arrive, so there is nothing for `settled` to mean, and the only
       thing on the canvas that can change is the two hundred-odd cells with a
       breath in them.
       .
       So it is its own loop and not a flag inside that one: those cells
       worked out and the changed ones repainted at 22Hz, and not one line of
       focal arithmetic run to produce a number that is always 1. It does not
       park , see `breathing` above for why the focus gate came off , and
       between breaths it dozes on `snooze`, so `document.hidden` is the only
       thing that stops it. */
    const breathFrame = (time: number) => {
      if (!running) return;
      now = time;
      if (applyViewport()) lastBreath = time;
      else if (time - lastBreath >= BREATH_FRAME) {
        renderBreath();
        lastBreath = time;
      }
      snooze(time);
    };

    /** Whichever loop this field is: the light's, or only the breath's. */
    const nextFrame = () => requestAnimationFrame(animating ? frame : breathFrame);

    /** Back from `settled`. Cheap enough to call from a pointermove: one test. */
    const wake = () => {
      if (!looping || !running) return;
      /* A DOZING LOOP IS A RUNNING LOOP. It was only skipping frames that had
         nothing to draw, so it comes back on the next one with its state
         untouched , no reset of the retarget, no full repaint , exactly as
         the loop that never dozed would have carried on. */
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
        lastFieldFrameAt = performance.now();
        lastCursorFrameAt = lastFieldFrameAt;
        raf = nextFrame();
        return;
      }
      if (raf) return;
      resting = false; // the frame it comes back on repaints the light in full
      lastFieldFrameAt = performance.now();
      lastCursorFrameAt = lastFieldFrameAt;
      // Or the first frame back pays a retarget it did not earn while nobody was here.
      lastRetarget = performance.now();
      raf = nextFrame();
    };

    /* The board publishes its FIRST footprint during the pointerdown whose
       capture listener just measured this canvas. A later move can follow a
       scroll, zoom or sidebar transition, so only that first signal may reuse
       the box. This avoids a layout read after selection has updated React. */
    let pressCanvasBox: DOMRect | null = null;

    const onPointerMove = (e: PointerEvent) => {
      if (press && e.pointerId === press.pointerId && !e.buttons) letGo(e); // the release happened where we could not hear it
      const rect = canvas.getBoundingClientRect();
      canvasBox = rect;
      if (press?.ring && e.pointerId === press.pointerId) {
        pressCanvasBox = null;
        press.ring.x = e.clientX - rect.left;
        press.ring.y = e.clientY - rect.top;
      } else if (press && !carrying && e.buttons && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_PX) {
        carrying = true;
        owed = ripples.length > 0;
        ripples.length = 0;
        if (owed) wake();
      }
      if (carrying) {
        /* Aimed but not woken: the light goes where the hand is at release. */
        tx = e.clientX - rect.left;
        ty = e.clientY - rect.top;
        return;
      }
      pointerInside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (cursorScale > 0) cursorHovering = pointerInside && e.pointerType === "mouse";
      if (pointerInside) {
        tx = e.clientX - rect.left;
        ty = e.clientY - rect.top;
        hand = { x: tx, y: ty };
      }
      wake();
    };

    const onPointerOut = (e: PointerEvent) => {
      if (e.relatedTarget || !cursorHovering) return;
      cursorHovering = false;
      wake();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return; // primary clicks / taps only
      released = null;
      const target = e.target;
      if (interactionRoot && !(target instanceof Node && interactionRoot.current?.contains(target))) {
        pointerInside = false;
        cursorHovering = false;
        wake();
        return;
      }
      /* Every work-area descendant may own a gesture. The press starts a ring;
         a marquee takes only its gesture signal once the board starts dragging. */
      const workArea = Boolean(interactionRoot);
      const rect = canvas.getBoundingClientRect();
      canvasBox = rect;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
      const ring = { x, y, start: performance.now(), held: workArea };
      pointerInside = true;
      pressCanvasBox = workArea ? rect : null;
      press = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, ring: workArea ? ring : null };
      ripples.push(ring);
      if (ripples.length > 5) ripples.shift(); // cap concurrent rings
      tx = x;
      ty = y;
      wake();
    };

    const letGo = (e: PointerEvent) => {
      if (press && e.pointerId !== press.pointerId) return;
      if (press?.ring) {
        const rect = canvas.getBoundingClientRect();
        canvasBox = rect;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        press.ring.x = x;
        press.ring.y = y;
        pointerInside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
        if (pointerInside) { tx = x; ty = y; }
        press.ring.held = false;
        if (press.ring.source === "marquee") {
          press = null;
          carrying = false;
          wake();
          return;
        }
        const at = performance.now();
        press.ring.start = at - RIPPLE_RISE_MS;
        const rise = Math.max(0, Math.min(1, (at - (press.ring.footprintAt ?? at)) / RIPPLE_RISE_MS));
        released = { pointerId: press.pointerId, ring: press.ring, at, from: rise * rise * (3 - 2 * rise) };
        wake();
      }
      press = null;
      if (!carrying) return;
      carrying = false;
      wake();
    };

    const cancelPress = (pointerId: number) => {
      if (!press || pointerId !== press.pointerId) return;
      released = null;
      if (press.ring) {
        const index = ripples.indexOf(press.ring);
        if (index >= 0) ripples.splice(index, 1);
      }
      if (press.ring || owed) {
        sweep(0, 0, width, height);
        prevBox = null;
        prevHeldBoxes = [];
        prevRippleBoxes = [];
        owed = false;
      }
      press = null;
      carrying = false;
      wake();
    };
    const onPointerCancel = (e: PointerEvent) => cancelPress(e.pointerId);

    const onFootprint = (footprint: SurfaceFieldFootprint) => {
      const { pointerId, rects, ids } = footprint;
      const source = footprint.suppressRipple ? "marquee" : "nodes";
      const ring = press?.pointerId === pointerId ? press.ring
        : released?.pointerId === pointerId && performance.now() - released.at < 100 ? released.ring : null;
      if (!ring) return;
      if (source === "marquee") {
        /* The board still publishes its rectangle for selection. Only included
           nodes light this field; the rectangle itself has no paint geometry. */
        ring.source = source;
        const index = ripples.indexOf(ring);
        if (index >= 0) ripples.splice(index, 1);
        wake();
        return;
      }
      if (!rects?.length) return;
      /* Pointer capture already measured the canvas on this event; the first
         press has its own box. A footprint must not force another layout read
         for every resize frame. */
      const footprintBox = footprint.initial && press?.ring === ring
        ? pressCanvasBox ?? canvasBox
        : canvasBox;
      if (!footprintBox) return;
      pressCanvasBox = null;
      const footprints: Footprint[] = [];
      for (const rect of rects) {
        if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) ||
            !Number.isFinite(rect.right) || !Number.isFinite(rect.bottom) ||
            rect.right <= rect.left || rect.bottom <= rect.top) continue;
        footprints.push({
          left: rect.left - footprintBox.left,
          top: rect.top - footprintBox.top,
          right: rect.right - footprintBox.left,
          bottom: rect.bottom - footprintBox.top,
        });
      }
      if (!footprints.length) return;
      /* AN EQUAL FOOTPRINT IS NO NEWS, and it keeps the objects the last held
         frame was drawn from, which is what lets the next one skip the held
         surface (`renderHeld`). A host that repeats itself costs nothing. */
      if (ring.footprints && ring.source === source && sameIds(ring.ids, ids) &&
          ring.footprints.length === footprints.length &&
          ring.footprints.every((shape, i) => {
            const next = footprints[i];
            return shape.left === next.left && shape.top === next.top && shape.right === next.right && shape.bottom === next.bottom;
          })) return;
      if (!ring.footprints) ring.footprintAt = performance.now();
      ring.source = source;
      ring.ids = ids;
      ring.footprints = footprints;
      wake();
    };
    const sameIds = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
      a === b || (!!a && !!b && a.length === b.length && a.every((id, i) => id === b[i]));
    const clearPreview = (committed = false) => {
      if (!preview || !preview.target) return;
      preview.target = 0;
      preview.holdUntil = committed ? performance.now() + 3 * RIPPLE_RISE_MS : 0;
      lastPreviewFrameAt = performance.now();
      previewTurning = true;
      wake();
    };
    const onPreview = ({ rect, committed }: SurfaceFieldPreview) => {
      if (!rect) { clearPreview(committed); return; }
      if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) ||
          !Number.isFinite(rect.right) || !Number.isFinite(rect.bottom) ||
          rect.right < rect.left || rect.bottom < rect.top) return;
      /* The pointer observer already measured this canvas in capture before
         the board's preview frame. A preview costs no second layout read. */
      const box = canvasBox ?? canvas.getBoundingClientRect();
      const shape = { left: rect.left - box.left, top: rect.top - box.top,
        right: rect.right - box.left, bottom: rect.bottom - box.top };
      if (preview) {
        if (!preview.target) lastPreviewFrameAt = performance.now();
        preview.shapes[0] = shape;
        preview.target = 1;
        preview.holdUntil = 0;
      } else {
        preview = { shapes: [shape], weight: 0, target: 1, holdUntil: 0 };
        lastPreviewFrameAt = performance.now();
      }
      previewTurning = true;
      wake();
    };
    /* Recorded here, drawn by the next frame; see `applyViewport`. Reduced
       motion has no frame to pick it up, so it draws at once. */
    const onViewport = (next: SurfaceFieldViewport | undefined) => {
      const value = normalizeViewport(next);
      if (sameViewport(value, view)) return;
      view = value;
      viewDirty = true;
      if (!looping) applyViewport();
      else wake();
    };
    const onScene = (scene: SurfaceFieldScene | null) => {
      sceneSnapshot = scene;
      sceneDirty = true;
      wake();
    };
    const onVisibility = () => {
      if (document.hidden) {
        cursorHovering = false;
        running = false;
        cancelAnimationFrame(raf);
        raf = 0;
        window.clearTimeout(timer);
        timer = 0;
      } else if (!running && looping) {
        running = true;
        raf = nextFrame();
      }
    };

    const onFocus = () => {
      focused = true;
      wake(); // the wander is allowed again, so the loop has something to do
    };
    /* The light is NOT parked or re-centred here: it keeps whatever position it
       had and simply stops being re-aimed, so the field somebody comes back to
       is the field they left. */
    const onBlur = () => {
      focused = false;
      if (cursorHovering) {
        cursorHovering = false;
        wake();
      }
      if (press?.ring) cancelPress(press.pointerId);
      clearPreview();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    /* IT REPAINTS, not just re-reads. On the reduced motion and `still`
       paths there is no frame loop to pick the new colour up, so the field
       kept the previous theme's ink: dark dots on dark paper, which is a
       field that has vanished until something forces a resize or a reload.
       `running` cannot be the test for that, because it starts true and only
       the visibility handler ever clears it. */
    const recolour = () => {
      readColor();
      prevBox = null;
      if (!looping || !running || (!raf && !timer)) render();
    };
    const themeObserver = new MutationObserver(recolour);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    resize();

    const unsubscribe = controller ? subscribeSurfaceField(controller, signal => {
      if (signal.kind === "scene") onScene(signal.value);
      else if (signal.kind === "footprint") onFootprint(signal.value);
      else if (signal.kind === "preview") onPreview(signal.value);
      else if (signal.kind === "viewport") {
        /* The host's first camera PLACES the floor, unless one was kept
           from before this effect ran; see `reseed`. */
        if (!viewFromController && !kept) reseed = true;
        viewFromController = true;
        onViewport(signal.value);
      } else recolour();
    }) : null;
    viewportRef.current = next => { if (!viewFromController) onViewport(next); };
    if (!looping) {
      /* ONE FRAME AND NO SUBSCRIPTIONS, which is now reduced motion alone:
         nothing on this canvas will ever change again, so a loop and three
         listeners would be watching for events they would throw away. */
      render();
    } else {
      /* THE HAND IS THE LIGHT'S, AND A TEXTURE HAS NO LIGHT. `still` subscribes
         to focus and to visibility because those are what let it stop costing
         anything, and to nothing else: a pointer it would do nothing with, and
         a ring it has no focal to drop, are two listeners running on every
         move of the mouse to reach a function that returns. */
      if (animating) {
        window.addEventListener("pointermove", onPointerMove, { passive: true, capture: true });
        if (cursorScale > 0) window.addEventListener("pointerout", onPointerOut, true);
        window.addEventListener("pointerdown", onPointerDown, { passive: true, capture: true });
        window.addEventListener("pointerup", letGo, { passive: true, capture: true });
        window.addEventListener("pointercancel", onPointerCancel, { passive: true, capture: true });
        /* FOCUS IS THE WANDER'S ALONE now that the breath does not answer to
           it. A texture has no wander, so on that path these two would be
           subscriptions kept for a variable nothing reads. */
        window.addEventListener("focus", onFocus);
        window.addEventListener("blur", onBlur);
      }
      document.addEventListener("visibilitychange", onVisibility);
      /* THE RING PROP IS THE LIGHT'S TOO, and `wake` is only hung for it. A
         texture has no focal for a ring to go out from, and `drainPending`
         runs inside `frame` , so hanging it here as well would let a caller
         queue rings into a loop that never drains them. */
      if (animating) wakeRef.current = wake;
      if (tintHueVar) {
        document.addEventListener("animationstart", onHueAnimation, true);
        document.addEventListener("animationend", onHueAnimation, true);
        document.addEventListener("animationcancel", onHueAnimation, true);
      }
      /* A replayed scene or camera above may already have woken the loop;
         a second request here would run two frame chains side by side. */
      if (!raf) raf = nextFrame();
    }

    return () => {
      running = false;
      wakeRef.current = null;
      viewportRef.current = null;
      cancelAnimationFrame(raf);
      raf = 0;
      window.clearTimeout(timer);
      timer = 0;
      resizeObserver.disconnect();
      themeObserver.disconnect();
      unsubscribe?.();
      window.removeEventListener("pointermove", onPointerMove, true);
      if (cursorScale > 0) window.removeEventListener("pointerout", onPointerOut, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", letGo, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("animationstart", onHueAnimation, true);
      document.removeEventListener("animationend", onHueAnimation, true);
      document.removeEventListener("animationcancel", onHueAnimation, true);
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
  ]);

  return (
    <div
      ref={containerRef}
      aria-hidden
      style={{ ...style, pointerEvents: "none", overflow: "hidden" }}
      className={className}
    >
      {connected ? <div style={{ display: "grid", gridTemplate: "minmax(0, 1fr) / minmax(0, 1fr)", width: "100%", height: "100%" }}>
        <canvas ref={fabricRef} style={{ gridArea: "1 / 1", width: "100%", height: "100%", minWidth: 0, minHeight: 0, color: "inherit" }} />
        <canvas ref={canvasRef} style={{ gridArea: "1 / 1", width: "100%", height: "100%", minWidth: 0, minHeight: 0, color: "inherit" }} />
      </div> : <canvas ref={canvasRef} style={{ width: "100%", height: "100%", color: "inherit" }} />}
    </div>
  );
}

export type SurfaceFieldProps = React.ComponentProps<typeof SurfaceField>;
