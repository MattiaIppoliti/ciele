"use client";

import { useEffect, useId } from "react";
import { useResizableWidth } from "@/components/ui/resizable-panel";

/**
 * The workspace's right rail, published as CSS custom properties.
 *
 * The rail's occupant (the live Preview, the Flows Agent, the Developer
 * Panel) is decided below `(admin)/layout.tsx`, where the viewport-fixed
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
 * Tracking is a transform, not `right`, so it moves on the compositor.
 */
const TRACKING_TRANSITION = "transform 200ms ease-out";
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
 * What the rail is, given everything currently publishing to it.
 *
 * One panel *holds* the rail, but several can be mounted at once: the Assistant
 * editor mounts the live Preview's launcher and, on the Flow canvas, the Flows
 * Agent, and opening either collapses the other. A collapsed panel publishes
 * `null`, so "last publisher wins" meant the collapsed one could clear the vars
 * the open one had just set — which is what happened, the Preview's launcher
 * being a later sibling than the canvas. A publisher with nothing to say is
 * therefore ignored rather than authoritative, and only the absence of *any*
 * occupant hands the vars back to the stylesheet.
 *
 * Pure, and the whole rule, so the arbitration is testable without a DOM.
 */
export function resolveRightRail(
  entries: ReadonlyArray<readonly [string, RightRail | null]>,
): RightRail | null {
  let occupant: RightRail | null = null;
  for (const [, rail] of entries) {
    if (rail && rail.width > 0) occupant = rail;
  }
  return occupant;
}

/** Every mounted publisher, in mount order. Module-level: the vars are too. */
const publishers = new Map<string, RightRail | null>();

function applyRightRail(): void {
  const vars = rightRailVars(resolveRightRail([...publishers]));
  const root = document.documentElement;
  for (const [name, value] of Object.entries(vars)) {
    if (value === null) root.style.removeProperty(name);
    else root.style.setProperty(name, value);
  }
}

/**
 * The width of a panel docked in the right rail, resizable, and published to
 * the shell in the same call.
 *
 * Every occupant sizes itself through this hook, so none can hold the rail
 * without the viewport-fixed furniture knowing how wide it is. That was the
 * Developer Panel's bug: it sized itself with `useResizableWidth` alone, never
 * published, and the notification stack sat on top of it.
 *
 * `occupied` false (a collapsed 48px strip, a full-route page) sizes without
 * publishing: there is nothing for the shell to move out of the way for.
 */
export function useDockedRail(
  options: Parameters<typeof useResizableWidth>[0],
  occupied: boolean,
): ReturnType<typeof useResizableWidth> {
  const sized = useResizableWidth(options);
  useRightRail(occupied ? { width: sized.width, animated: !sized.resizing } : null);
  return sized;
}

/**
 * Publish this component's occupancy of the right rail, `null` for none.
 *
 * Deregisters on unmount, so navigating away from a rail page returns the fixed
 * furniture to the viewport edge, and so that a panel leaving while another
 * still holds the rail leaves that one's width standing.
 */
function useRightRail(rail: RightRail | null): void {
  const id = useId();
  const width = rail?.width ?? 0;
  const animated = rail?.animated ?? false;
  useEffect(() => {
    publishers.set(id, width > 0 ? { width, animated } : null);
    applyRightRail();
    return () => {
      publishers.delete(id);
      applyRightRail();
    };
  }, [id, width, animated]);
}
