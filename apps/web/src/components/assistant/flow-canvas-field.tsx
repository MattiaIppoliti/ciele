"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { useStoreApi, type ReactFlowState } from "@xyflow/react";
import { SurfaceField, createSurfaceFieldController, type SurfaceFieldController } from "@/vendor/surface-field";
import {
  FLOW_FIELD_SETTINGS,
  nodeScreenRects,
  sameFieldRects,
  toViewportRects,
  type FieldRect,
} from "@/lib/flow-canvas-field";

/**
 * The Flow Canvas floor: surface-field in place of React Flow's `<Background>`.
 *
 * The grid pans with the camera and zooms with a little parallax, every step
 * card clears a band round itself, a card being dragged carries its clearing
 * with it, and the pointer lights the fabric under it. It is decorative: the
 * canvases are `aria-hidden` and never take a pointer event, so nothing about
 * selecting, dragging or dropping a step changes.
 *
 * Must render inside the `ReactFlowProvider`: the bridge reads React Flow's
 * store directly, which is what lets the camera and the node boxes reach the
 * field on the same tick without re-rendering the graph.
 */
export function FlowCanvasField({
  root,
  themeKey,
}: {
  /** The box the flow and the field share; scene rects are relative to it. */
  root: RefObject<HTMLDivElement | null>;
  /** Changes when the console theme flips, so the dots re-read their colour. */
  themeKey: string;
}) {
  const controller = useMemo(() => createSurfaceFieldController(), []);

  // Presses count only on the graph itself: a click on the toolbar, the node
  // panel or the prompt bar floating over it should not drop a ring.
  const interactionRoot = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    interactionRoot.current =
      root.current?.querySelector<HTMLElement>(".react-flow__renderer") ?? root.current;
  });

  useEffect(() => {
    controller.refreshTheme();
  }, [controller, themeKey]);

  return (
    <>
      <SurfaceField
        {...FLOW_FIELD_SETTINGS}
        controller={controller}
        interactionRoot={interactionRoot}
        style={{ position: "absolute", inset: 0, color: "var(--foreground)" }}
      />
      <FieldBridge controller={controller} root={root} />
    </>
  );
}

/** Renders nothing: forwards React Flow's store to the field's controller. */
function FieldBridge({
  controller,
  root,
}: {
  controller: SurfaceFieldController;
  root: RefObject<HTMLDivElement | null>;
}) {
  const store = useStoreApi();

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let viewport = { x: Number.NaN, y: Number.NaN, zoom: Number.NaN };
    let scene: FieldRect[] = [];
    let first = true;
    // React Flow's drag does not expose the pointer that started it, so the
    // bridge remembers the press. A press on a step card is the card's
    // gesture: the footprint says so with `suppressRipple`, and the field lays
    // no ring under a card being picked up.
    let press: { pointerId: number; box: DOMRect; initial: boolean; onNode: boolean } | null = null;

    const footprint = (rects: readonly FieldRect[]) => {
      if (!press || rects.length === 0) return;
      controller.setFootprint({
        pointerId: press.pointerId,
        ids: rects.map((rect) => rect.id),
        initial: press.initial || undefined,
        suppressRipple: press.onNode || undefined,
        rects: toViewportRects(rects, press.box),
      });
      press.initial = false;
    };

    const sync = (state: ReactFlowState) => {
      const [x, y, zoom] = state.transform;
      if (x !== viewport.x || y !== viewport.y || zoom !== viewport.zoom) {
        viewport = { x, y, zoom };
        controller.setViewport(viewport);
      }
      const next = nodeScreenRects(state.transform, state.nodeLookup.values());
      if (first || !sameFieldRects(next, scene)) {
        first = false;
        scene = next;
        controller.setScene({ root: element, rects: scene });
      }
      if (press) footprint(nodeScreenRects(state.transform, state.nodeLookup.values(), true));
    };

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      const nodeId = target?.closest<HTMLElement>(".react-flow__node")?.dataset.id;
      press = {
        pointerId: event.pointerId,
        box: element.getBoundingClientRect(),
        initial: true,
        onNode: Boolean(nodeId),
      };
      if (nodeId) footprint(scene.filter((rect) => rect.id === nodeId));
    };
    const onUp = (event: PointerEvent) => {
      if (press?.pointerId === event.pointerId) press = null;
    };

    element.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    sync(store.getState());
    const unsubscribe = store.subscribe(sync);
    return () => {
      unsubscribe();
      element.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
  }, [controller, root, store]);

  useEffect(() => () => controller.setScene(null), [controller]);
  return null;
}
