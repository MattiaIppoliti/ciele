"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { grabOffsetFor, resizeWidthFor } from "./resize-geometry";

/**
 * Drag-to-resize width for a panel pinned to one edge of its container.
 * "right"-anchored panels (the chat preview, the help-desk edit drawer, the
 * docs Ask AI drawer) grow by dragging their left edge left; width is measured
 * from the pointer back to the panel's fixed right edge so it never jitters
 * mid-drag.
 *
 * Shared byte-for-byte across apps. The visual handle is app-specific (each app
 * has its own design tokens); this hook owns only the resize behavior. Render
 * any handle and wire its `onPointerDown` to `beginResize(event)`, and attach
 * `containerRef` to the panel element.
 *
 * Three things this hook owns that its callers kept getting wrong:
 *
 *   - **Grab offset.** The handle is 12px wide and straddles the panel edge, so
 *     setting the edge to the raw clientX teleports the panel by up to 6px on
 *     the first move. `beginResize` takes the event and captures the offset.
 *   - **Pointer capture.** Tracking used to live on `window`, which loses the
 *     drag over an iframe and never hears `pointercancel`. The handle captures
 *     the pointer instead.
 *   - **The transition class.** Every caller had to remember
 *     `resizing ? "" : "transition-[width]"`, and one of the three forgot,
 *     which made that panel lag 200ms behind the pointer for the whole drag.
 *     `widthTransition` is returned already correct.
 */
export function useResizableWidth({
  defaultWidth,
  minWidth,
  maxWidth,
  initialResizing = false,
  overdrag,
}: {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  /** Mount already mid-drag (e.g. the panel was opened by dragging a collapsed rail). */
  initialResizing?: boolean;
  /**
   * Spotify-style overdrag. While dragging, the width may go below minWidth
   * (content fades out via the returned `fade`). On release: below
   * collapseThreshold the panel collapses (onCollapse fires), between the
   * threshold and minWidth it snaps back up to minWidth.
   */
  overdrag?: {
    railWidth: number;
    collapseThreshold: number;
    onCollapse: () => void;
  };
}) {
  const [width, setWidth] = useState(
    initialResizing && overdrag ? overdrag.railWidth : defaultWidth,
  );
  const [resizing, setResizing] = useState(initialResizing);
  const containerRef = useRef<HTMLElement>(null);
  // Latest values for the release handler without re-binding listeners.
  const widthRef = useRef(width);
  const overdragRef = useRef(overdrag);
  const grabOffsetRef = useRef(0);
  const handleRef = useRef<HTMLElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  useEffect(() => {
    widthRef.current = width;
    overdragRef.current = overdrag;
  });

  const releasePointer = useCallback(() => {
    const handle = handleRef.current;
    const pointerId = pointerIdRef.current;
    if (handle && pointerId !== null && handle.hasPointerCapture?.(pointerId)) {
      handle.releasePointerCapture(pointerId);
    }
    handleRef.current = null;
    pointerIdRef.current = null;
  }, []);

  useEffect(() => {
    if (!resizing) return;
    const endResize = () => {
      const od = overdragRef.current;
      const current = widthRef.current;
      if (od && current < minWidth) {
        if (current < od.collapseThreshold) {
          od.onCollapse();
          setWidth(defaultWidth); // fresh width for the next open
        } else {
          setWidth(minWidth); // snap up to the readable minimum
        }
      } else if (current > maxWidth) {
        setWidth(maxWidth); // release the rubber-band
      } else if (!od && current < minWidth) {
        setWidth(minWidth);
      }
      releasePointer();
      setResizing(false);
    };
    const onMove = (e: PointerEvent) => {
      // The pointer was released before our listeners attached (can happen
      // when a drag starts on a rail that mounts this panel mid-drag).
      if (e.buttons === 0) {
        endResize();
        return;
      }
      const rect = containerRef.current?.getBoundingClientRect();
      setWidth(
        resizeWidthFor({
          pointer: e.clientX,
          grabOffset: grabOffsetRef.current,
          anchor: "right",
          containerEdge: rect?.right ?? window.innerWidth,
          minWidth,
          maxWidth,
          overdragTo: overdragRef.current?.railWidth,
        }),
      );
    };
    const target: EventTarget = handleRef.current ?? window;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    target.addEventListener("pointermove", onMove as EventListener);
    target.addEventListener("pointerup", endResize);
    // A cancelled pointer (OS gesture, focus loss) must end the drag too, or
    // the panel stays glued to a pointer that is no longer being tracked.
    target.addEventListener("pointercancel", endResize);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      target.removeEventListener("pointermove", onMove as EventListener);
      target.removeEventListener("pointerup", endResize);
      target.removeEventListener("pointercancel", endResize);
    };
  }, [resizing, minWidth, maxWidth, defaultWidth, releasePointer]);

  /** 0 at the rail, 1 from minWidth up, drives the content fade during overdrag. */
  const fade = overdrag
    ? Math.min(
        1,
        Math.max(
          0,
          (width - overdrag.railWidth) / (minWidth - overdrag.railWidth),
        ),
      )
    : 1;

  /**
   * Start a drag. Pass the pointerdown event so the grab offset and pointer
   * capture are set up; `startWidth` opens from a specific width (e.g. the
   * collapsed rail's).
   */
  function beginResize(
    event: { clientX: number; pointerId: number; currentTarget: EventTarget | null },
    startWidth?: number,
  ) {
    const rect = containerRef.current?.getBoundingClientRect();

    // The edge being dragged is the panel's left edge (right-anchored panel).
    // When `startWidth` is given the panel is about to jump to that width, and
    // `setWidth` has not committed yet, so `rect.left` still describes the
    // *old* edge. Derive the edge the drag will actually start from instead, or
    // the rail-to-expand drag captures an offset for an edge that no longer
    // exists and the panel leaps on the first move.
    const edge =
      startWidth !== undefined && rect
        ? rect.right - startWidth
        : (rect?.left ?? event.clientX);
    grabOffsetRef.current = grabOffsetFor(edge, event.clientX);

    if (startWidth !== undefined) setWidth(startWidth);
    else if (rect) {
      // Start from the presentation value, not the state value. A re-grab
      // during the 200ms snap-back drops the transition class, and if state
      // still held the target the panel would jump from wherever the animation
      // had reached to that target. Seeding state with the on-screen width
      // makes the interruption continuous.
      setWidth(rect.width);
    }

    const handle = event.currentTarget as HTMLElement | null;
    if (handle?.setPointerCapture) {
      handle.setPointerCapture(event.pointerId);
      handleRef.current = handle;
      pointerIdRef.current = event.pointerId;
    }
    setResizing(true);
  }

  return {
    width,
    fade,
    resizing,
    setResizing,
    beginResize,
    containerRef,
    /**
     * Class for the panel's width transition. Empty while dragging so the panel
     * tracks 1:1, and present otherwise so the snap-back animates. Returned
     * rather than left to each caller, because one of three callers forgot it.
     */
    widthTransition: resizing ? "" : "transition-[width] duration-200 ease-out",
  };
}
