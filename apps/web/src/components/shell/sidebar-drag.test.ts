import { describe, expect, it } from "vitest";
import {
  DEFAULT_WIDTH,
  HIDE_AT,
  ICON_ONLY_AT,
  MAX_WIDTH,
  HIDE_FLICK_VELOCITY,
  isRailWidth,
  sidebarDragFor,
  sidebarReleaseFor,
} from "./sidebar-drag";

describe("sidebarDragFor", () => {
  it("respects the grab offset instead of snapping the edge to the pointer", () => {
    // The handle is 12px wide and straddles the edge, so grabbing its right
    // half puts the pointer 6px past the edge it moves.
    expect(sidebarDragFor(306, 6).width).toBe(300);
    expect(sidebarDragFor(294, -6).width).toBe(300);
  });

  it("does not move when the pointer has not moved off the grab point", () => {
    expect(sidebarDragFor(246, 6).width).toBe(240);
  });

  it("clamps to the allowed range", () => {
    expect(sidebarDragFor(9999, 0).width).toBe(MAX_WIDTH);
    expect(sidebarDragFor(-50, 0).width).toBe(HIDE_AT);
  });

  it("arms the hide once past the threshold, without ending the drag", () => {
    const armed = sidebarDragFor(HIDE_AT - 10, 0);
    expect(armed.armedToHide).toBe(true);
    // Still reports a width: the gesture is live and the panel still tracks.
    expect(armed.width).toBeGreaterThanOrEqual(HIDE_AT);
  });

  it("disarms when the pointer comes back, so a slip is recoverable", () => {
    expect(sidebarDragFor(HIDE_AT - 10, 0).armedToHide).toBe(true);
    expect(sidebarDragFor(HIDE_AT + 10, 0).armedToHide).toBe(false);
  });

  it("is not armed anywhere in the normal range", () => {
    for (const pointer of [HIDE_AT, 120, ICON_ONLY_AT, DEFAULT_WIDTH, MAX_WIDTH]) {
      expect(sidebarDragFor(pointer, 0).armedToHide).toBe(false);
    }
  });
});

describe("isRailWidth", () => {
  it("switches to the icon rail below the threshold", () => {
    expect(isRailWidth(ICON_ONLY_AT - 1)).toBe(true);
    expect(isRailWidth(ICON_ONLY_AT)).toBe(false);
    expect(isRailWidth(DEFAULT_WIDTH)).toBe(false);
  });
});

describe("sidebarReleaseFor", () => {
  it("keeps the dragged width when released in range", () => {
    const drag = sidebarDragFor(320, 0);
    expect(sidebarReleaseFor(drag, 240)).toEqual({ docked: true, width: 320 });
  });

  it("hides on release when armed", () => {
    const drag = sidebarDragFor(20, 0);
    expect(sidebarReleaseFor(drag, 240).docked).toBe(false);
  });

  it("preserves the pre-drag width through a hide, not the default", () => {
    const drag = sidebarDragFor(20, 0);
    // 200 was a deliberate choice; a slip past the threshold must not cost it.
    expect(sidebarReleaseFor(drag, 200).width).toBe(200);
  });

  it("keeps a dragged-down rail width so it reopens as a rail", () => {
    const drag = sidebarDragFor(100, 0);
    const release = sidebarReleaseFor(drag, 240);
    expect(release.docked).toBe(true);
    expect(isRailWidth(release.width)).toBe(true);
  });

  it("hides on a hard leftward flick that never reached the threshold", () => {
    // Stopped at 300px, but thrown left hard: the throw meant to close.
    const drag = sidebarDragFor(300, 0);
    expect(drag.armedToHide).toBe(false);
    const release = sidebarReleaseFor(drag, 240, HIDE_FLICK_VELOCITY - 100);
    expect(release).toEqual({ docked: false, width: 240 });
  });

  it("keeps a slow drag docked at the same position", () => {
    const drag = sidebarDragFor(300, 0);
    expect(sidebarReleaseFor(drag, 240, -50).docked).toBe(true);
  });

  it("rescues an armed drag flicked back toward the content", () => {
    // Past the threshold, but travelling right fast: the gesture reversed.
    const drag = sidebarDragFor(20, 0);
    expect(drag.armedToHide).toBe(true);
    expect(sidebarReleaseFor(drag, 240, 1200).docked).toBe(true);
  });

  it("still hides when armed and released without velocity", () => {
    const drag = sidebarDragFor(20, 0);
    expect(sidebarReleaseFor(drag, 240, 0).docked).toBe(false);
  });

  it("commits nothing on a drag that was armed and then brought back", () => {
    sidebarDragFor(20, 0);
    const recovered = sidebarDragFor(300, 0);
    expect(sidebarReleaseFor(recovered, 240)).toEqual({
      docked: true,
      width: 300,
    });
  });
});
