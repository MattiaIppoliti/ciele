import type { SurfaceFieldViewport } from "./viewport";

export type { SurfaceFieldViewport } from "./viewport";

export type SurfaceFieldRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type SurfaceFieldScene = {
  /** Scene rectangles are CSS pixels relative to this element's border box. */
  root: HTMLElement;
  rects: readonly (SurfaceFieldRect & { id: string; parent: string | null })[];
};

export type SurfaceFieldFootprint = {
  pointerId: number;
  /** Footprints are viewport CSS rectangles, such as getBoundingClientRect returns. */
  rects: readonly SurfaceFieldRect[];
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
};

type Signal =
  | { kind: "scene"; value: SurfaceFieldScene | null }
  | { kind: "footprint"; value: SurfaceFieldFootprint }
  | { kind: "preview"; value: SurfaceFieldPreview }
  | { kind: "theme" }
  | { kind: "viewport"; value: SurfaceFieldViewport };

type State = {
  scene: SurfaceFieldScene | null;
  /* Retained like the scene: a camera is state, not a gesture, so a field
     that mounts late or remounts under strict mode must open where the host
     is looking rather than at the origin. */
  viewport: SurfaceFieldViewport | null;
  listener: ((signal: Signal) => void) | null;
};
const states = new WeakMap<SurfaceFieldController, State>();

/** One controller belongs to one field. Geometry updates never cause React renders. */
export function createSurfaceFieldController(): SurfaceFieldController {
  const state: State = { scene: null, viewport: null, listener: null };
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
  return () => { if (state.listener === listener) state.listener = null; };
}
