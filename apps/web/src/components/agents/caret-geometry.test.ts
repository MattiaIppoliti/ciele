import { describe, expect, it } from "vitest";
import { caretPlacement } from "./caret-geometry";

const base = { markerLeft: 42, markerTop: 30, markerHeight: 18, scrollTop: 0, clientHeight: 96 };

describe("caretPlacement", () => {
  it("draws the caret where the mirror measured it when nothing is scrolled", () => {
    expect(caretPlacement(base)).toEqual({ x: 42, y: 30, height: 18 });
  });

  it("follows the textarea's scroll offset", () => {
    expect(caretPlacement({ ...base, markerTop: 150, scrollTop: 100 })).toEqual({ x: 42, y: 50, height: 18 });
  });

  it("hides a caret scrolled above or below the box instead of pinning it to the edge", () => {
    expect(caretPlacement({ ...base, markerTop: 10, scrollTop: 40 })).toBeNull();
    expect(caretPlacement({ ...base, markerTop: 90 })).toBeNull();
  });

  it("tolerates a sub-pixel overhang on the last visible line", () => {
    expect(caretPlacement({ ...base, markerTop: 78.6 })).not.toBeNull();
  });
});
