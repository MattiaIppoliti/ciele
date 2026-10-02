import type { SurfaceFieldViewport } from "./viewport";

export type { SurfaceFieldViewport } from "./viewport";

/**
 * A surface's own box, before any rotation. Without the optional fields it
 * is a plain rectangle, as it has always been.
 */
export type SurfaceFieldRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Corner radius in CSS px, clamped to half the shorter side: a square at its half is a circle, a bar a pill. */
  radius?: number;
  /** An ellipse inscribed in the box instead of a rectangle. `radius` does not apply. */
  shape?: "rect" | "ellipse";
  /** Clockwise turn in degrees about the box's centre, as CSS `rotate()`. */
  rotation?: number;
};

/**
 * A connection between two surfaces, drawn as a channel of the field's own
 * dots along a path: only the dots on the path answer it, lit as a surface's
 * rim is, moving or not. If it moves, the wave a click sends runs along it,
 * pushing, lifting and tinting the dots it crosses. Coordinates are the
 * scene's (CSS pixels relative to the scene root), so a host that follows a
 * camera sends its links with its scene.
 */
export type SurfaceFieldLink = {
  /** Scene ids of the two ends. Without `points`, the path is a soft curve from the edge of one to the edge of the other, aimed centre to centre. */
  from?: string;
  to?: string;
  /** The path itself, as a polyline in the scene root's CSS pixels, when the host already has one (a React Flow edge). Wins over `from`/`to`. */
  points?: readonly { x: number; y: number }[];
  /** Width of the wave's corridor in CSS pixels. Default 56, about three dots across at the default spacing; the resting line is half as wide. */
  width?: number;
  /** `"loop"` sends a wave from `from` to `to` again and again, `"bounce"` back and forth. Default `"still"`. Never moves under reduced motion or `still`. */
  motion?: "still" | "loop" | "bounce";
  /** Speed of the wave in CSS pixels per second. Default 220. */
  speed?: number;
  /**
   * Moving links that share a sequence carry ONE wave through them, in the
   * order they are listed: it leaves one link's far end as it enters the
   * next one's, as a signal passing through the surface they share. The
   * first link of a sequence sets its motion, speed and direction. Without
   * a sequence each link carries its own wave.
   */
  sequence?: string;
  /** How strong the wave is: 1 moves a dot as far as a click's ring does (`ripplePush`). Default 1, up to 4; 0 hides the link. */
  strength?: number;
};

export type SurfaceFieldScene = {
  /** Scene rectangles are CSS pixels relative to this element's border box. */
  root: HTMLElement;
  rects: readonly (SurfaceFieldRect & { id: string; parent: string | null })[];
};

export type SurfaceFieldFootprint = {
  pointerId: number;
  /**
   * Footprints are viewport CSS rectangles, such as getBoundingClientRect
   * returns. A rect that names its scene `id` is that object's live shape: a
   * link to it follows the hand until the scene catches up.
   */
  rects: readonly (SurfaceFieldRect & { id?: string })[];
  ids?: readonly string[];
  initial?: true;
  /** Suppress the held press ring while another gesture owns that press. */
  suppressRipple?: boolean;
};

export type SurfaceFieldPreview = {
  /** A viewport CSS rectangle, or null to release the preview. */
  rect: SurfaceFieldRect | null;
  committed?: true;
};

export type SurfaceFieldController = {
  setScene(scene: SurfaceFieldScene | null): void;
  setFootprint(footprint: SurfaceFieldFootprint): void;
  setPreview(preview: SurfaceFieldPreview): void;
  refreshTheme(): void;
  /**
   * The host's camera, React Flow semantics: world (wx, wy) is drawn at
   * (wx * zoom + x, wy * zoom + y) CSS px from the field root. The grid pans
   * with it exactly and zooms with parallax, a floor below the nodes.
   * Once called, it takes precedence over the `viewport` prop for this field.
   */
  setViewport(viewport: SurfaceFieldViewport): void;
  /**
   * The connections to draw in the field, or null for none. Retained like
   * the scene and replayed on attachment. A field without links pays nothing.
   */
  setLinks(links: readonly SurfaceFieldLink[] | null): void;
};

type Signal =
  | { kind: "scene"; value: SurfaceFieldScene | null }
  | { kind: "footprint"; value: SurfaceFieldFootprint }
  | { kind: "preview"; value: SurfaceFieldPreview }
  | { kind: "theme" }
  | { kind: "viewport"; value: SurfaceFieldViewport }
  | { kind: "links"; value: readonly SurfaceFieldLink[] | null };

type State = {
  scene: SurfaceFieldScene | null;
  /* Retained like the scene: a camera is state, not a gesture, so a field
     that mounts late or remounts under strict mode must open where the host
     is looking rather than at the origin. */
  viewport: SurfaceFieldViewport | null;
  links: readonly SurfaceFieldLink[] | null;
  listener: ((signal: Signal) => void) | null;
};
const states = new WeakMap<SurfaceFieldController, State>();

/** One controller belongs to one field. Geometry updates never cause React renders. */
export function createSurfaceFieldController(): SurfaceFieldController {
  const state: State = { scene: null, viewport: null, links: null, listener: null };
  const send = (signal: Signal) => state.listener?.(signal);
  const controller: SurfaceFieldController = {
    setScene(scene) { state.scene = scene; send({ kind: "scene", value: scene }); },
    setFootprint(value) { send({ kind: "footprint", value }); },
    setPreview(value) { send({ kind: "preview", value }); },
    refreshTheme() { send({ kind: "theme" }); },
    setViewport(viewport) {
      /* Copied, so a host that mutates one camera object in place cannot
         change the retained value behind the field's back. */
      const value = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
      state.viewport = value;
      send({ kind: "viewport", value });
    },
    setLinks(links) {
      /* Copied for the viewport's reason: a host that edits its array in
         place cannot change what the field holds behind its back. */
      const value = links ? links.map(link => link.points ? { ...link, points: link.points.map(p => ({ x: p.x, y: p.y })) } : { ...link }) : null;
      state.links = value;
      send({ kind: "links", value });
    },
  };
  states.set(controller, state);
  return controller;
}

/** The component's private subscription. A late mount receives the latest layout. */
export function subscribeSurfaceField(controller: SurfaceFieldController, listener: (signal: Signal) => void): () => void {
  const state = states.get(controller);
  if (!state) throw new Error("SurfaceField requires a controller from createSurfaceFieldController");
  if (state.listener) throw new Error("A SurfaceField controller may be attached to only one field");
  state.listener = listener;
  listener({ kind: "scene", value: state.scene });
  if (state.viewport) listener({ kind: "viewport", value: state.viewport });
  if (state.links) listener({ kind: "links", value: state.links });
  return () => { if (state.listener === listener) state.listener = null; };
}
