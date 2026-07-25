"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Drag-to-resize width for a panel pinned to one edge of its container.
 * "right"-anchored panels (the chat preview, the help-desk edit drawer, the
 * docs Ask AI drawer) grow by dragging their left edge left; width is measured
 * from the pointer back to the panel's fixed right edge so it never jitters
 * mid-drag.
 *
 * Shared byte-for-byte across apps. The visual handle is app-specific (each app
 * has its own design tokens); this hook owns only the resize behavior. Render
 * any handle and wire its `onPointerDown` to `beginResize()`, and attach
 * `containerRef` to the panel element.
 */
export function useResizableWidth({
  defaultWidth,
  minWidth,
  maxWidth,
  anchor = "right",
  initialResizing = false,
  overdrag,
}: {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  anchor?: "left" | "right";
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
  useEffect(() => {
    widthRef.current = width;
    overdragRef.current = overdrag;
  });

  useEffect(() => {
    if (!resizing) return;
    const lowerBound = overdragRef.current?.railWidth ?? minWidth;
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
      }
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
      const next =
        anchor === "right"
          ? (rect?.right ?? window.innerWidth) - e.clientX
          : e.clientX - (rect?.left ?? 0);
      setWidth(Math.min(maxWidth, Math.max(lowerBound, next)));
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endResize);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", endResize);
    };
  }, [resizing, anchor, minWidth, maxWidth, defaultWidth]);

  /** 0 at the rail, 1 from minWidth up — drives the content fade during overdrag. */
  const fade = overdrag
    ? Math.min(
        1,
        Math.max(
          0,
          (width - overdrag.railWidth) / (minWidth - overdrag.railWidth),
        ),
      )
    : 1;

  /** Start a drag, optionally from a given width (e.g. the collapsed rail's). */
  function beginResize(startWidth?: number) {
    if (startWidth !== undefined) setWidth(startWidth);
    setResizing(true);
  }

  return { width, fade, resizing, setResizing, beginResize, containerRef };
}
