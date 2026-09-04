import { afterEach, describe, expect, it, vi } from "vitest";

import {
  nextToggleState,
  playFeedback,
  setActiveFeedbackRuntime,
  type FeedbackRuntime,
} from "./runtime";

describe("playFeedback", () => {
  afterEach(() => setActiveFeedbackRuntime(null));

  it("is a no-op with no provider mounted, which is how the widget stays silent", () => {
    expect(() => playFeedback("success")).not.toThrow();
  });

  it("forwards to the mounted runtime", () => {
    const play = vi.fn();
    const runtime: FeedbackRuntime = { play, unlocked: true, destroy: () => {} };
    setActiveFeedbackRuntime(runtime);
    playFeedback("error");
    expect(play).toHaveBeenCalledWith("error");
  });
});

describe("nextToggleState", () => {
  it("trusts a state that moved between capture and bubble", () => {
    expect(nextToggleState(false, true)).toBe(true);
    expect(nextToggleState(true, false)).toBe(false);
  });

  it("inverts a state React had not flushed yet", () => {
    expect(nextToggleState(false, false)).toBe(true);
    expect(nextToggleState(true, true)).toBe(false);
  });

  it("uses whichever reading exists when the other is missing", () => {
    expect(nextToggleState(null, true)).toBe(true);
    expect(nextToggleState(true, null)).toBe(false);
  });

  it("gives up when neither reading exists", () => {
    expect(nextToggleState(null, null)).toBeNull();
  });
});
