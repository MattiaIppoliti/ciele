import { describe, expect, it } from "vitest";
import { shellHotkey, type HotkeyEvent } from "./shell-hotkeys";

const key = (value: string, over: Partial<HotkeyEvent> = {}): HotkeyEvent => ({
  key: value,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  typing: false,
  ...over,
});

const page = { pageHasApiDomains: true };

describe("the shell's keyboard shortcuts", () => {
  it("opens Find on F and on Cmd/Ctrl+K", () => {
    expect(shellHotkey(key("f"), page)).toBe("find");
    expect(shellHotkey(key("F"), page)).toBe("find");
    expect(shellHotkey(key("k", { metaKey: true }), page)).toBe("find");
    expect(shellHotkey(key("k", { ctrlKey: true }), page)).toBe("find");
  });

  it("starts a new chat on Cmd/Ctrl+O, and not on a chord that adds Shift or Alt", () => {
    expect(shellHotkey(key("o", { metaKey: true }), page)).toBe("newChat");
    expect(shellHotkey(key("O", { ctrlKey: true }), page)).toBe("newChat");
    expect(shellHotkey(key("o", { metaKey: true, shiftKey: true }), page)).toBeNull();
    expect(shellHotkey(key("o", { ctrlKey: true, altKey: true }), page)).toBeNull();
  });

  it("answers a modifier chord even from inside a text box, and a bare letter never", () => {
    expect(shellHotkey(key("k", { metaKey: true, typing: true }), page)).toBe("find");
    expect(shellHotkey(key("o", { metaKey: true, typing: true }), page)).toBe("newChat");
    expect(shellHotkey(key("f", { typing: true }), page)).toBeNull();
    expect(shellHotkey(key("d", { typing: true }), page)).toBeNull();
  });

  it("toggles the Developer Panel on D only where the page has one", () => {
    expect(shellHotkey(key("d"), page)).toBe("developerPanel");
    expect(shellHotkey(key("d"), { pageHasApiDomains: false })).toBeNull();
  });

  it("leaves every other key, and a letter under a modifier, to the page", () => {
    expect(shellHotkey(key("x"), page)).toBeNull();
    expect(shellHotkey(key("f", { metaKey: true }), page)).toBeNull();
    expect(shellHotkey(key("d", { altKey: true }), page)).toBeNull();
  });
});
