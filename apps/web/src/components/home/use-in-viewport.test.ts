import { describe, expect, it } from "vitest";
import { shouldAnimate } from "./use-in-viewport";

describe("shouldAnimate", () => {
  it("runs only when visible and reduced-motion is off", () => {
    expect(shouldAnimate({ visible: true, reducedMotion: false })).toBe(true);
  });

  it("pauses when off screen", () => {
    expect(shouldAnimate({ visible: false, reducedMotion: false })).toBe(false);
  });

  it("pauses when reduced-motion is on, even if visible", () => {
    expect(shouldAnimate({ visible: true, reducedMotion: true })).toBe(false);
  });

  it("pauses when both off screen and reduced-motion", () => {
    expect(shouldAnimate({ visible: false, reducedMotion: true })).toBe(false);
  });
});
