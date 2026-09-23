"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface PillRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Shared state for a single "pill" that glides between the rows of a menu,
 * the command palette's sliding active-row effect. The pill appears in place
 * on first `show` (no slide from where it last was), glides while moving
 * between rows, and fades out in place on `hide`.
 *
 * `pillNode` must be rendered inside a `relative` container that is the
 * rows' offsetParent, and rows must be `relative` themselves so they paint
 * above it. Works inside scroll containers: the pill is absolutely
 * positioned in the content box, so it scrolls with the rows it highlights.
 *
 * Drive it from any highlight signal: `HoverHighlight` below wires it to
 * mouseover, the dropdown menu wires it to Base UI's focus-based
 * highlighting (which also covers keyboard navigation).
 */
export function useSlidingPill(pillClassName?: string) {
  const [pill, setPill] = useState<{ rect: PillRect; slide: boolean } | null>(
    null,
  );
  const [visible, setVisible] = useState(false);
  // Refs, not state, so high-frequency callers (mouseover fires for every
  // child the cursor crosses) can bail out without a re-render.
  const visibleRef = useRef(false);
  const lastTargetRef = useRef<HTMLElement | null>(null);

  /**
   * Place the pill at a rect already measured in the pill's own coordinates.
   *
   * `el` is identity only, so a second mouseover on the same row is a no-op.
   */
  const showRect = useCallback((el: HTMLElement, rect: PillRect) => {
    if (el === lastTargetRef.current && visibleRef.current) return;
    lastTargetRef.current = el;
    setPill({ rect, slide: visibleRef.current });
    visibleRef.current = true;
    setVisible(true);
  }, []);

  /**
   * Place it from the row's offset box. Correct only where the row's
   * offsetParent *is* the pill's container; `HoverHighlight` measures
   * against the container instead, because a row nested in any positioned
   * wrapper reports offsets relative to that wrapper and the pill lands at
   * the top-left of the menu.
   */
  const show = useCallback(
    (el: HTMLElement) =>
      showRect(el, {
        top: el.offsetTop,
        left: el.offsetLeft,
        width: el.offsetWidth,
        height: el.offsetHeight,
      }),
    [showRect]
  );

  const hide = useCallback(() => {
    visibleRef.current = false;
    lastTargetRef.current = null;
    setVisible(false);
  }, []);

  /** Forget the pill entirely, for containers that unmount and remount
   * (e.g. a popup), so a reopen doesn't slide from a stale position. */
  const reset = useCallback(() => {
    visibleRef.current = false;
    lastTargetRef.current = null;
    setPill(null);
    setVisible(false);
  }, []);

  const pillNode = useMemo(
    () =>
      pill ? (
        <div
          aria-hidden
          className={cn(
            "bg-muted pointer-events-none absolute top-0 left-0 rounded-lg transition-opacity duration-150 ease-out motion-reduce:transition-none",
            pill.slide && "transition-[transform,width,height,opacity]",
            visible ? "opacity-100" : "opacity-0",
            pillClassName,
          )}
          style={{
            width: pill.rect.width,
            height: pill.rect.height,
            transform: `translate(${pill.rect.left}px, ${pill.rect.top}px)`,
          }}
        />
      ) : null,
    [pill, visible, pillClassName],
  );

  return { show, showRect, hide, reset, pillNode };
}

/**
 * Mouse-driven wrapper around `useSlidingPill`: rows opt in with
 * `data-highlight-row` (and must be `relative`), and the pill follows the
 * hovered row, fading out when the cursor leaves the container.
 */
export function HoverHighlight({
  className,
  highlightClassName,
  children,
  ...props
}: React.ComponentProps<"div"> & { highlightClassName?: string }) {
  const { showRect, hide, pillNode } = useSlidingPill(highlightClassName);

  function onMouseOver(event: React.MouseEvent<HTMLDivElement>) {
    const row = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-highlight-row]",
    );
    if (!row || !event.currentTarget.contains(row)) return;
    // Measured against this container, not the row's offsetParent. A row
    // inside a positioned wrapper (the sidebar's fold groups are `relative`,
    // so the fold chevron has something to sit against) reported an offset of
    // zero, and the pill drew itself at the top-left of the nav behind
    // whatever was there.
    //
    // The scroll offsets are the other half of that. Two bounding rects give
    // the row's position in the *viewport*, and the pill is absolutely
    // positioned in the container's **content** box, which scrolls: the org
    // switcher and the assistant scope switcher are both
    // `max-h-72 overflow-y-auto`, so in a list scrolled 150px down the pill
    // would otherwise be drawn 150px above the row under the pointer.
    const scroller = event.currentTarget;
    const container = scroller.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    showRect(row, {
      top: box.top - container.top + scroller.scrollTop,
      left: box.left - container.left + scroller.scrollLeft,
      width: box.width,
      height: box.height,
    });
  }

  return (
    <div
      {...props}
      className={cn("relative", className)}
      onMouseOver={onMouseOver}
      onMouseLeave={hide}
    >
      {pillNode}
      {children}
    </div>
  );
}
