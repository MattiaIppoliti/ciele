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
  hapticsCreated: vi.fn(),
  hapticsDestroyed: vi.fn(),
  hapticsTriggered: vi.fn(),
}));
vi.mock("./sounds/bencho", () => ({ createBenchoPlayer: engines.createBenchoPlayer }));
vi.mock("@foleyjs/core", () => ({ play: engines.oldPlay, set: vi.fn() }));
vi.mock("@web-kits/audio", () => ({ createPatchInstance: () => ({ play: engines.oldPlay }) }));
vi.mock("web-haptics", () => ({ WebHaptics: class { constructor() { engines.hapticsCreated(); } trigger(input: unknown) { engines.hapticsTriggered(input); } destroy() { engines.hapticsDestroyed(); } } }));

describe("delegated menu scroll haptics", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

  it("requires a user scroll gesture and suppresses hidden, reduced-motion and expired gestures", async () => {
    class MenuElement {
      scrollTop = 0;
      closest(selector: string) { return selector === "[data-foley-scroll]" ? this : null; }
      getAttribute() { return null; }
      hasAttribute() { return false; }
    }
    let reducedMotion = false;
    const win = { matchMedia: (query: string) => ({ matches: query === "(pointer: coarse)" || reducedMotion }) };
    vi.stubGlobal("Element", MenuElement);
    vi.stubGlobal("window", win);
    vi.stubGlobal("navigator", {});
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const doc = Object.assign(new EventTarget(), { defaultView: win, hidden: false });
    const element = new MenuElement();
    const emit = (name: string) => {
      const event = new Event(name);
      Object.defineProperty(event, "target", { value: element });
      doc.dispatchEvent(event);
    };
    const runtime = attachFeedback(doc as unknown as Document, { isMuted: () => true });
    try {
      element.scrollTop = 100;
      emit("scroll");
      expect(engines.hapticsTriggered).not.toHaveBeenCalled();
      emit("pointerdown");
      await vi.waitFor(() => expect(engines.hapticsCreated).toHaveBeenCalledOnce());
      element.scrollTop = 144;
      emit("scroll");
      expect(engines.hapticsTriggered).toHaveBeenCalledOnce();
      doc.hidden = true;
      element.scrollTop = 188;
      now = 100;
      emit("scroll");
      doc.hidden = false;
      reducedMotion = true;
      now = 200;
      emit("scroll");
      reducedMotion = false;
      now = 2000;
      element.scrollTop = 232;
      emit("scroll");
      expect(engines.hapticsTriggered).toHaveBeenCalledOnce();
      emit("touchmove");
      element.scrollTop = 276;
      emit("scroll");
      expect(engines.hapticsTriggered).toHaveBeenCalledTimes(2);
      emit("keydown");
      element.scrollTop = 320;
      now = 2100;
      emit("scroll");
      expect(engines.hapticsTriggered).toHaveBeenCalledTimes(2);
    } finally { runtime.destroy(); }
    emit("touchmove");
    element.scrollTop = 364;
    emit("scroll");
    expect(engines.hapticsTriggered).toHaveBeenCalledTimes(2);
  });
});

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
    expect(engines.hapticsDestroyed).toHaveBeenCalledOnce();
  });

  it("does not construct an audio player after unmount during lazy loading", async () => {
    const doc = Object.assign(new EventTarget(), { defaultView: null, hidden: false });
    const runtime = attachFeedback(doc as unknown as Document, { soundSet: "bencho", isMuted: () => false });
    doc.dispatchEvent(new Event("keydown"));
    runtime.destroy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(engines.createBenchoPlayer).not.toHaveBeenCalled();
    expect(engines.hapticsCreated).not.toHaveBeenCalled();
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
