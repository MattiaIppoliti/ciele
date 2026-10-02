import { afterEach, describe, expect, it, vi } from "vitest";

import {
  nextToggleState,
  attachFeedback,
  playFeedback,
  setActiveFeedbackRuntime,
  type FeedbackRuntime,
} from "./runtime";

const engines = vi.hoisted(() => ({
  createBenchoPlayer: vi.fn(),
  play: vi.fn(),
  destroy: vi.fn(),
  oldPlay: vi.fn(),
}));
vi.mock("./sounds/bencho", () => ({ createBenchoPlayer: engines.createBenchoPlayer }));
vi.mock("@foleyjs/core", () => ({ play: engines.oldPlay, set: vi.fn() }));
vi.mock("@web-kits/audio", () => ({ createPatchInstance: () => ({ play: engines.oldPlay }) }));
vi.mock("web-haptics", () => ({ WebHaptics: class { trigger() {} } }));

describe("admin sound identity", () => {
  afterEach(() => vi.clearAllMocks());

  it("loads after a gesture and uses Bencho for chat and interface cues", async () => {
    const doc = Object.assign(new EventTarget(), { defaultView: null, hidden: false });
    let muted = false;
    engines.createBenchoPlayer.mockReturnValue({ play: engines.play, destroy: engines.destroy });
    const runtime = attachFeedback(doc as unknown as Document, { soundSet: "bencho", isMuted: () => muted });
    runtime.play("send");
    expect(engines.createBenchoPlayer).not.toHaveBeenCalled();
    expect(engines.play).not.toHaveBeenCalled();
    doc.dispatchEvent(new Event("keydown"));
    runtime.play("send");
    await vi.waitFor(() => expect(engines.play).toHaveBeenCalledWith("send", undefined));
    runtime.play("release");
    expect(engines.play).toHaveBeenCalledWith("release", undefined);
    expect(engines.oldPlay).not.toHaveBeenCalled();
    engines.play.mockClear();
    muted = true;
    runtime.play("reply");
    muted = false;
    doc.hidden = true;
    runtime.play("error");
    expect(engines.play).not.toHaveBeenCalled();
    runtime.destroy();
    expect(engines.destroy).toHaveBeenCalledOnce();
  });

  it("does not construct an audio player after unmount during lazy loading", async () => {
    const doc = Object.assign(new EventTarget(), { defaultView: null, hidden: false });
    const runtime = attachFeedback(doc as unknown as Document, { soundSet: "bencho", isMuted: () => false });
    doc.dispatchEvent(new Event("keydown"));
    runtime.destroy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(engines.createBenchoPlayer).not.toHaveBeenCalled();
  });
});

describe("playFeedback", () => {
  afterEach(() => setActiveFeedbackRuntime(null));

  it("is a no-op with no provider mounted, which is how the widget stays silent", () => {
    expect(() => playFeedback("success")).not.toThrow();
  });

  it("forwards to the mounted runtime", () => {
    const play = vi.fn();
    const runtime: FeedbackRuntime = { play, destroy: () => {} };
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
