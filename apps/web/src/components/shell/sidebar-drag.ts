// Pure rules for the shell sidebar's resize gesture.
//
// The behaviour this replaces terminated the drag the instant the pointer
// crossed HIDE_AT and reset the width to the default in the same breath. Two
// things were wrong with that: the gesture ended while the finger was still
// down, so there was no dragging back to cancel; and the width the user had
// set was destroyed by a slip, even though every other path through this
// component preserves it on purpose.
//
// Here, crossing the threshold only *arms* the outcome. Nothing is committed
// until release, and dragging back disarms it.

export const DEFAULT_WIDTH = 240;
export const MAX_WIDTH = 400;
/** Below this width, labels would truncate illegibly, switch to icons only. */
export const ICON_ONLY_AT = 168;
/** Fixed width of the collapsed icon-only rail, hugs the icons instead of
 * following the drag position, so there's no dead space next to them. */
export const RAIL_WIDTH = 60;
/** Releasing the resize handle below this point hides the sidebar entirely.
 * Must stay below RAIL_WIDTH, otherwise the handle (parked at RAIL_WIDTH
 * while collapsed) starts inside the hide zone and dragging right to expand
 * closes the sidebar instead. */
export const HIDE_AT = 48;

export interface SidebarDrag {
  /** Width to render right now, including any sub-threshold travel. */
  width: number;
  /** Release here and the sidebar hides. Drag back and this clears. */
  armedToHide: boolean;
}

export interface SidebarRelease {
  /** False means the sidebar leaves the layout. */
  docked: boolean;
  /**
   * Width to keep. On a hide this is the width the sidebar had *before* the
   * gesture, so reopening restores what the user chose rather than the default.
   */
  width: number;
}

/**
 * State for a pointer at `pointer`, given the offset captured on pointerdown.
 * Never ends the drag: crossing HIDE_AT arms, it does not commit.
 */
export function sidebarDragFor(pointer: number, grabOffset: number): SidebarDrag {
  const edge = pointer - grabOffset;
  // Arm from the raw edge, clamp only what gets rendered: the two answer
  // different questions and a single clamped number cannot serve both.
  return {
    width: Math.max(HIDE_AT, Math.min(MAX_WIDTH, edge)),
    armedToHide: edge < HIDE_AT,
  };
}

/** Whether the current drag width should render the icon rail. */
export function isRailWidth(width: number): boolean {
  return width < ICON_ONLY_AT;
}

/**
 * A leftward flick this fast commits to hiding even if the pointer never
 * reached HIDE_AT. Position alone cannot tell a deliberate throw from a slow
 * drag that stopped early, and the throw plainly meant to close.
 */
export const HIDE_FLICK_VELOCITY = -900;

/**
 * Outcome of letting go. `widthBeforeDrag` is what the sidebar measured when
 * the gesture started, and is what a hide preserves. `velocity` is the
 * pointer's horizontal speed at release in px/s, negative when moving left.
 */
export function sidebarReleaseFor(
  drag: SidebarDrag,
  widthBeforeDrag: number,
  velocity = 0,
): SidebarRelease {
  // A hard flick back toward the content disarms a hide the pointer had
  // already crossed into: the gesture reversed, and the last thing the hand
  // did outranks where it happened to stop.
  if (drag.armedToHide && velocity > -HIDE_FLICK_VELOCITY) {
    return { docked: true, width: drag.width };
  }
  if (drag.armedToHide || velocity <= HIDE_FLICK_VELOCITY) {
    return { docked: false, width: widthBeforeDrag };
  }
  return { docked: true, width: drag.width };
}
