import { describe, expect, it } from "vitest";
import {
  DECELERATION_RATE,
  nearestIndex,
  projectMomentum,
  sheetReleaseFor,
} from "./projection";

describe("projectMomentum", () => {
  it("is zero for a release with no velocity", () => {
    expect(projectMomentum(0)).toBe(0);
  });

  it("carries the sign of the gesture", () => {
    expect(projectMomentum(800)).toBeGreaterThan(0);
    expect(projectMomentum(-800)).toBeLessThan(0);
  });

  it("projects further the harder the flick", () => {
    expect(projectMomentum(1600)).toBeGreaterThan(projectMomentum(800));
  });

  it("is linear in velocity, so twice the flick travels twice as far", () => {
    expect(projectMomentum(1600)).toBeCloseTo(projectMomentum(800) * 2, 6);
  });

  it("projects a 1000px/s flick about half a screen, not half a pixel", () => {
    // The textbook v²/(2a) form gets this wrong by orders of magnitude; this is
    // the exponential-decay form scroll deceleration actually uses.
    expect(projectMomentum(1000)).toBeGreaterThan(400);
    expect(projectMomentum(1000)).toBeLessThan(600);
  });

  it("resists a snappier deceleration rate", () => {
    expect(projectMomentum(1000, 0.99)).toBeLessThan(
      projectMomentum(1000, DECELERATION_RATE),
    );
  });
});

describe("nearestIndex", () => {
  it("picks the closest candidate", () => {
    expect(nearestIndex(0.55, [0.25, 0.5, 0.92])).toBe(1);
    expect(nearestIndex(0.9, [0.25, 0.5, 0.92])).toBe(2);
    expect(nearestIndex(0.1, [0.25, 0.5, 0.92])).toBe(0);
  });

  it("is stable on an exact tie, preferring the earlier candidate", () => {
    expect(nearestIndex(0.5, [0.25, 0.75])).toBe(0);
  });
});

describe("sheetReleaseFor", () => {
  // Sheet is 800px tall; snaps at half height and near-full.
  const base = {
    snapPoints: [0.5, 0.92],
    currentIndex: 1,
    viewportHeight: 800,
    sheetTop: 0,
    dismissThreshold: 120,
  };

  it("dismisses on a hard downward fling even from a small offset", () => {
    // 20px dragged, but thrown hard: the projection lands well past the sheet.
    const result = sheetReleaseFor({ ...base, offset: 20, velocity: 2400 });
    expect(result.kind).toBe("dismiss");
  });

  it("does not dismiss on a slow drag that never left the top snap", () => {
    const result = sheetReleaseFor({ ...base, offset: 12, velocity: 40 });
    expect(result).toEqual({ kind: "snap", index: 1 });
  });

  it("steps down a snap on a moderate downward drag", () => {
    const result = sheetReleaseFor({ ...base, offset: 200, velocity: 120 });
    expect(result).toEqual({ kind: "snap", index: 0 });
  });

  it("steps up on an upward flick from the lower snap", () => {
    const result = sheetReleaseFor({
      ...base,
      currentIndex: 0,
      offset: -30,
      velocity: -900,
    });
    expect(result).toEqual({ kind: "snap", index: 1 });
  });

  it("dismisses from the lowest snap when flung down past everything", () => {
    const result = sheetReleaseFor({
      ...base,
      currentIndex: 0,
      offset: 260,
      velocity: 1500,
    });
    expect(result.kind).toBe("dismiss");
  });

  it("uses velocity direction, not just position, to decide", () => {
    // The snaps sit 0.42 of an 800px viewport apart, so their midpoint is at
    // ~168px of drag. 200px is past it: released dead, the sheet steps down.
    // Thrown back up from the same point, it stays where it was.
    const released = sheetReleaseFor({ ...base, offset: 200, velocity: 0 });
    const thrownBack = sheetReleaseFor({
      ...base,
      offset: 200,
      velocity: -1200,
    });
    expect(released).toEqual({ kind: "snap", index: 0 });
    expect(thrownBack).toEqual({ kind: "snap", index: 1 });
  });

  it("never returns an index outside the snap points", () => {
    for (const velocity of [-9000, -100, 0, 100, 9000]) {
      for (const offset of [-900, -100, 0, 100, 900]) {
        const result = sheetReleaseFor({ ...base, offset, velocity });
        if (result.kind === "snap") {
          expect(result.index).toBeGreaterThanOrEqual(0);
          expect(result.index).toBeLessThan(base.snapPoints.length);
        }
      }
    }
  });

  it("handles a single snap point without trying to step past it", () => {
    const result = sheetReleaseFor({
      ...base,
      snapPoints: [0.6],
      currentIndex: 0,
      offset: -40,
      velocity: -1500,
    });
    expect(result).toEqual({ kind: "snap", index: 0 });
  });
});
