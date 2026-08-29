import { describe, expect, it } from "vitest";
import { shouldVibrate, type HapticEnvironment } from "./haptics";

const capable: HapticEnvironment = {
  supported: true,
  coarsePointer: true,
  reducedMotion: false,
};

describe("shouldVibrate", () => {
  it("fires on a touch device that supports it", () => {
    expect(shouldVibrate(capable)).toBe(true);
  });

  it("stays silent where the API is missing", () => {
    expect(shouldVibrate({ ...capable, supported: false })).toBe(false);
  });

  it("stays silent on a mouse, where nothing is being held", () => {
    // Desktop Chrome exposes navigator.vibrate and does nothing with it; the
    // check that matters is whether the device is in someone's hand.
    expect(shouldVibrate({ ...capable, coarsePointer: false })).toBe(false);
  });

  it("respects reduced motion, which covers motion you feel too", () => {
    expect(shouldVibrate({ ...capable, reducedMotion: true })).toBe(false);
  });

  it("needs every condition, not just one", () => {
    expect(
      shouldVibrate({
        supported: true,
        coarsePointer: true,
        reducedMotion: true,
      }),
    ).toBe(false);
    expect(
      shouldVibrate({
        supported: false,
        coarsePointer: true,
        reducedMotion: false,
      }),
    ).toBe(false);
  });
});
