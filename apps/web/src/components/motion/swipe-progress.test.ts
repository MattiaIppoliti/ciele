import { describe, expect, it } from "vitest";

import {
  SWIPE_END_TOLERANCE,
  SWIPE_KEY_STEPS,
  SWIPE_START,
  clampOffset,
  isAtEnd,
  maxSwipeFor,
  swipeProgress,
  swipeStateFor,
  swipeStateForKey,
} from "./swipe-progress";

const MAX = 200;

describe("maxSwipeFor", () => {
  it("is the track minus the handle and both gaps", () => {
    expect(maxSwipeFor(300, 40, 3)).toBe(254);
  });

  it("never goes negative when the handle is wider than the track", () => {
    expect(maxSwipeFor(20, 40, 3)).toBe(0);
  });
});

describe("clampOffset", () => {
  it("clamps to the track", () => {
    expect(clampOffset(-50, MAX)).toBe(0);
    expect(clampOffset(80, MAX)).toBe(80);
    expect(clampOffset(9999, MAX)).toBe(MAX);
  });

  it("collapses to 0 while the track is unmeasured", () => {
    expect(clampOffset(80, 0)).toBe(0);
  });
});

describe("isAtEnd", () => {
  it("allows the tolerance a drag never lands exactly on", () => {
    expect(isAtEnd(MAX - SWIPE_END_TOLERANCE, MAX)).toBe(true);
    expect(isAtEnd(MAX - SWIPE_END_TOLERANCE - 1, MAX)).toBe(false);
  });

  it("is never at the end before layout is measured", () => {
    expect(isAtEnd(0, 0)).toBe(false);
  });
});

describe("swipeProgress", () => {
  it("reports 0–100 for aria-valuenow", () => {
    expect(swipeProgress(0, MAX)).toBe(0);
    expect(swipeProgress(MAX / 2, MAX)).toBe(50);
    expect(swipeProgress(MAX, MAX)).toBe(100);
    expect(swipeProgress(MAX * 2, MAX)).toBe(100);
    expect(swipeProgress(10, 0)).toBe(0);
  });
});

describe("swipeStateForKey", () => {
  it("advances a fraction of the track per arrow press", () => {
    const first = swipeStateForKey("ArrowRight", SWIPE_START, MAX);
    expect(first.handled).toBe(true);
    expect(first.commit).toBe(false);
    expect(first.state.offset).toBe(MAX / SWIPE_KEY_STEPS);
    expect(first.state.atEnd).toBe(false);
  });

  it("needs the full step sequence before it can commit", () => {
    let state = SWIPE_START;
    for (let i = 0; i < SWIPE_KEY_STEPS - 1; i += 1) {
      const step = swipeStateForKey("ArrowRight", state, MAX);
      state = step.state;
      // Enter mid-way is swallowed, not a confirm.
      expect(swipeStateForKey("Enter", state, MAX).commit).toBe(false);
    }

    state = swipeStateForKey("ArrowRight", state, MAX).state;
    expect(state.offset).toBe(MAX);
    expect(state.atEnd).toBe(true);
    expect(swipeStateForKey("Enter", state, MAX).commit).toBe(true);
    expect(swipeStateForKey(" ", state, MAX).commit).toBe(true);
  });

  it("does not commit on a single keypress from the start", () => {
    for (const key of ["Enter", " ", "Spacebar"]) {
      const result = swipeStateForKey(key, SWIPE_START, MAX);
      expect(result.commit).toBe(false);
      // Still owned by the control, so the browser default is suppressed.
      expect(result.handled).toBe(true);
      expect(result.state).toEqual(SWIPE_START);
    }
  });

  it("jumps to the commit zone on End and walks back on ArrowLeft", () => {
    const end = swipeStateForKey("End", SWIPE_START, MAX);
    expect(end.state).toEqual({ offset: MAX, atEnd: true });

    const back = swipeStateForKey("ArrowLeft", end.state, MAX);
    expect(back.state.offset).toBe(MAX - MAX / SWIPE_KEY_STEPS);
    expect(back.state.atEnd).toBe(false);
    expect(swipeStateForKey("Enter", back.state, MAX).commit).toBe(false);
  });

  it("returns to the start on Home and Escape", () => {
    const end = swipeStateForKey("End", SWIPE_START, MAX).state;
    expect(swipeStateForKey("Home", end, MAX).state).toEqual(SWIPE_START);
    expect(swipeStateForKey("Escape", end, MAX).state).toEqual(SWIPE_START);
  });

  it("cannot commit while the track is unmeasured", () => {
    const atEnd = { offset: 0, atEnd: true };
    expect(swipeStateForKey("Enter", atEnd, 0).commit).toBe(false);
  });

  it("leaves keys it does not own to the browser", () => {
    const result = swipeStateForKey("Tab", SWIPE_START, MAX);
    expect(result).toEqual({ state: SWIPE_START, commit: false, handled: false });
  });
});

describe("swipeStateFor", () => {
  it("is the only builder of a state — clamps and derives atEnd together", () => {
    expect(swipeStateFor(-10, MAX)).toEqual({ offset: 0, atEnd: false });
    expect(swipeStateFor(MAX + 500, MAX)).toEqual({ offset: MAX, atEnd: true });
  });
});
