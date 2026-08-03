import { describe, expect, it } from "vitest";
import {
  SWIPE_DISMISS_DISTANCE,
  SWIPE_DISMISS_MIN_DISTANCE,
  SWIPE_DISMISS_VELOCITY,
  shouldDismissSwipe,
} from "./swipe-dismiss";

describe("shouldDismissSwipe", () => {
  it("dismisses a slow drag past the distance threshold", () => {
    expect(
      shouldDismissSwipe({ offset: SWIPE_DISMISS_DISTANCE, velocity: 0 }),
    ).toBe(true);
  });

  it("dismisses a short fast flick", () => {
    expect(
      shouldDismissSwipe({
        offset: SWIPE_DISMISS_MIN_DISTANCE,
        velocity: SWIPE_DISMISS_VELOCITY,
      }),
    ).toBe(true);
  });

  it("keeps the card when a fast flick barely moved", () => {
    expect(
      shouldDismissSwipe({ offset: 6, velocity: SWIPE_DISMISS_VELOCITY * 4 }),
    ).toBe(false);
  });

  it("keeps the card when a long-enough drag was too slow", () => {
    expect(
      shouldDismissSwipe({ offset: SWIPE_DISMISS_MIN_DISTANCE, velocity: 10 }),
    ).toBe(false);
  });

  it("ignores leftward travel, however far or fast", () => {
    expect(
      shouldDismissSwipe({
        offset: -SWIPE_DISMISS_DISTANCE * 3,
        velocity: -SWIPE_DISMISS_VELOCITY * 3,
      }),
    ).toBe(false);
    expect(shouldDismissSwipe({ offset: 0, velocity: 0 })).toBe(false);
  });
});
