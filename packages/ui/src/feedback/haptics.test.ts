import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FALLBACK_DURATIONS_MS,
  haptic,
  setHapticTransport,
  shouldVibrate,
  type HapticEnvironment,
} from "./haptics";

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
    expect(shouldVibrate({ supported: true, coarsePointer: true, reducedMotion: true })).toBe(false);
    expect(shouldVibrate({ supported: false, coarsePointer: true, reducedMotion: false })).toBe(false);
  });
});

describe("haptic", () => {
  afterEach(() => {
    setHapticTransport(null);
    vi.unstubAllGlobals();
  });

  it("prefers an installed transport and hands it the kind", () => {
    const transport = vi.fn();
    setHapticTransport(transport);
    haptic("commit", capable);
    expect(transport).toHaveBeenCalledWith("commit");
  });

  it("falls back to the Vibration API with the kind's duration", () => {
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { vibrate });
    haptic("detent", capable);
    expect(vibrate).toHaveBeenCalledWith(FALLBACK_DURATIONS_MS.detent);
  });

  it("does nothing when the policy says no, even with a transport", () => {
    const transport = vi.fn();
    setHapticTransport(transport);
    haptic("press", { ...capable, coarsePointer: false });
    expect(transport).not.toHaveBeenCalled();
  });

  it("swallows a refusing transport", () => {
    setHapticTransport(() => {
      throw new Error("no gesture yet");
    });
    expect(() => haptic("press", capable)).not.toThrow();
  });
});
