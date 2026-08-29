"use client";

import { useEffect } from "react";

/**
 * The workspace's right rail, published as CSS custom properties.
 *
 * The rail's occupant (today the assistant editor's live preview) is decided
 * three layout levels below `(admin)/layout.tsx`, where the viewport-fixed
 * furniture, the bottom-right notification stack, is mounted. The two need
 * to agree on how wide the rail currently is, and the width is a
 * drag-resizable number that changes every pointer frame.
 *
 * Custom properties on `<html>` are the seam rather than React context on
 * purpose: a context value would re-render the whole admin tree on every frame
 * of a resize drag, while the browser resolves a changed variable at paint.
 *
 * The vars are declared with their neutral defaults in `globals.css`, so a page
 * with nothing in the rail needs no publisher at all. One occupant at a time is
 * the assumption, the rail holds a single panel by construction, and a second
 * concurrent publisher would be last-write-wins.
 *
 * Consumers apply the offset from `md` up only: the rail's panel is
 * `hidden md:flex`, so a published width is a width the layout is not actually
 * giving it below that breakpoint.
 */
export const RIGHT_RAIL_WIDTH_VAR = "--right-rail-width";
export const RIGHT_RAIL_TRANSITION_VAR = "--right-rail-transition";

/**
 * A collapse or expand animates the panel's width over 200ms, so anything
 * tracking the rail has to travel with it instead of jumping to the end state.
 * A resize drag is already following the pointer and must not lag behind it.
 */
const TRACKING_TRANSITION = "right 200ms ease-out";
const NO_TRANSITION = "none";

export interface RightRail {
  /** Rail width in CSS pixels, measured from the viewport's right edge. */
  width: number;
  /** False mid-drag: the pointer is the clock, not a duration. */
  animated: boolean;
}

/**
 * The variable values for a given rail state, or `null` per var to hand back to
 * the stylesheet default. Pure, so the geometry is testable without a DOM.
 */
export function rightRailVars(
  rail: RightRail | null,
): Record<string, string | null> {
  if (!rail || rail.width <= 0) {
    return {
      [RIGHT_RAIL_WIDTH_VAR]: null,
      [RIGHT_RAIL_TRANSITION_VAR]: null,
    };
  }
  return {
    [RIGHT_RAIL_WIDTH_VAR]: `${Math.round(rail.width)}px`,
    [RIGHT_RAIL_TRANSITION_VAR]: rail.animated
      ? TRACKING_TRANSITION
      : NO_TRANSITION,
  };
}

/**
 * Publish this component's occupancy of the right rail. Pass `null` when it
 * occupies nothing the rest of the shell should move out of the way for, a
 * collapsed 48px rail holds one button at its top, and a full-route or
 * fullscreen preview is not a rail at all.
 *
 * Clears the vars on unmount, so navigating away from a rail page returns the
 * fixed furniture to the viewport edge.
 */
export function useRightRail(rail: RightRail | null): void {
  const width = rail?.width ?? 0;
  const animated = rail?.animated ?? false;
  useEffect(() => {
    const root = document.documentElement;
    const vars = rightRailVars(width > 0 ? { width, animated } : null);
    for (const [name, value] of Object.entries(vars)) {
      if (value === null) root.style.removeProperty(name);
      else root.style.setProperty(name, value);
    }
    return () => {
      root.style.removeProperty(RIGHT_RAIL_WIDTH_VAR);
      root.style.removeProperty(RIGHT_RAIL_TRANSITION_VAR);
    };
  }, [width, animated]);
}
