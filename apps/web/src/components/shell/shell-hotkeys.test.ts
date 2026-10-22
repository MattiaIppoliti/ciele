import { describe, expect, it } from "vitest";
import {
  BINDINGS,
  GO_BINDINGS,
  SEQUENCE_WINDOW_MS,
  isApplePlatform,
  resolveHotkey,
  shellHotkey,
  shortcutGroups,
  type HotkeyEvent,
} from "./shell-hotkeys";
import { GLOBAL_NAV, navItem } from "./nav";

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
const names = (id: Parameters<typeof navItem>[0]) => navItem(id).label;

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
    expect(shellHotkey(key("Enter", { ctrlKey: true, typing: true }), page)).toBe("submit");
    expect(shellHotkey(key("f", { typing: true }), page)).toBeNull();
    expect(shellHotkey(key("d", { typing: true }), page)).toBeNull();
  });

  it("toggles the Developer Panel on D only where the page has one", () => {
    expect(shellHotkey(key("d"), page)).toBe("developerPanel");
    expect(shellHotkey(key("d"), { pageHasApiDomains: false })).toBeNull();
  });

  it("leaves every other key, and a letter under a modifier, to the page", () => {
    expect(shellHotkey(key("x"), page)).toBeNull();
    expect(shellHotkey(key("Enter"), page)).toBeNull();
    expect(shellHotkey(key("f", { metaKey: true }), page)).toBeNull();
    expect(shellHotkey(key("d", { altKey: true }), page)).toBeNull();
  });
});

describe("the keyboard layer (#1071)", () => {
  it("opens the shortcuts on ?, Find on /, and toggles the sidebar on [", () => {
    expect(shellHotkey(key("?", { shiftKey: true }), page)).toBe("shortcuts");
    expect(shellHotkey(key("/"), page)).toBe("find");
    expect(shellHotkey(key("["), page)).toBe("toggleSidebar");
  });

  it("reads [ typed with AltGr, which Windows reports as Ctrl+Alt", () => {
    // Italian: AltGr+è. German: AltGr+8. Either way the key produced is `[`.
    expect(shellHotkey(key("[", { ctrlKey: true, altKey: true }), page)).toBe("toggleSidebar");
    // macOS layouts type it with Option alone.
    expect(shellHotkey(key("[", { altKey: true }), page)).toBe("toggleSidebar");
    // A symbol typed with Shift, as `/` is on an Italian keyboard.
    expect(shellHotkey(key("/", { shiftKey: true }), page)).toBe("find");
    // Still a chord, and still the page's, when Cmd or Ctrl is held without Alt.
    expect(shellHotkey(key("[", { ctrlKey: true }), page)).toBeNull();
    expect(shellHotkey(key("[", { metaKey: true }), page)).toBeNull();
    expect(shellHotkey(key("[", { metaKey: true, altKey: true }), page)).toBeNull();
    // Nor does AltGr make a symbol fire inside a text box.
    expect(shellHotkey(key("[", { ctrlKey: true, altKey: true, typing: true }), page)).toBeNull();
  });

  it("creates a Task on N and a Project on P, never while typing", () => {
    expect(shellHotkey(key("n"), page)).toBe("newTask");
    expect(shellHotkey(key("p"), page)).toBe("newProject");
    for (const value of ["n", "p", "?", "/", "[", "g"]) {
      expect(resolveHotkey(key(value, { typing: true }), page, null, 0)).toEqual({ command: null, pending: null });
    }
  });

  it("goes to a page on G then its letter, inside the window only", () => {
    const started = resolveHotkey(key("g"), page, null, 1_000);
    expect(started).toEqual({ command: null, pending: { startedAt: 1_000 } });
    expect(resolveHotkey(key("t"), page, started.pending, 1_000 + SEQUENCE_WINDOW_MS).command).toEqual({ go: "my-tasks" });
    // Too late: the letter is itself again (`P` is New project, `T` nothing).
    expect(resolveHotkey(key("p"), page, started.pending, 1_001 + SEQUENCE_WINDOW_MS).command).toBe("newProject");
    expect(resolveHotkey(key("t"), page, started.pending, 1_001 + SEQUENCE_WINDOW_MS).command).toBeNull();
  });

  it("answers the sequence before N and P, so G N and G P open pages", () => {
    const pending = { startedAt: 0 };
    expect(resolveHotkey(key("n"), page, pending, 10).command).toEqual({ go: "notifications" });
    expect(resolveHotkey(key("p"), page, pending, 10).command).toEqual({ go: "projects" });
  });

  it("binds exactly the letters #1052 decided", () => {
    expect(Object.fromEntries(GO_BINDINGS.map((binding) => [binding.letter, binding.go]))).toEqual({
      h: "assistants",
      t: "my-tasks",
      p: "projects",
      a: "tasks",
      i: "inbox",
      s: "settings",
      n: "notifications",
    });
    // A letter #1052 leaves out is not a target.
    for (const letter of ["m", "c", "r", "e", "l", "x"]) {
      expect(resolveHotkey(key(letter), page, { startedAt: 0 }, 10).command).toBeNull();
    }
  });

  it("never lets a sequence shadow F or D", () => {
    const pending = { startedAt: 0 };
    expect(resolveHotkey(key("f"), page, pending, 10).command).toBe("find");
    expect(resolveHotkey(key("d"), page, pending, 10).command).toBe("developerPanel");
    const letters = GO_BINDINGS.map((binding) => binding.letter);
    expect(letters).not.toContain("f");
    expect(letters).not.toContain("d");
  });

  it("targets real pages, one letter each", () => {
    const ids = new Set(GLOBAL_NAV.map((item) => item.id));
    for (const binding of GO_BINDINGS) expect(ids.has(binding.go)).toBe(true);
    const letters = GO_BINDINGS.map((binding) => binding.letter);
    expect(new Set(letters).size).toBe(letters.length);
    expect(new Set(GO_BINDINGS.map((binding) => binding.go)).size).toBe(GO_BINDINGS.length);
  });
});

describe("the ? dialog (#1071)", () => {
  const groups = (apple: boolean) => shortcutGroups(names, { apple });

  it("lists every binding, and only the bindings, the resolver answers", () => {
    const rows = groups(true)
      .filter((group) => group.title !== "Go to")
      .flatMap((group) => group.rows);
    expect(rows.map((row) => row.label)).toEqual(BINDINGS.map((binding) => binding.label));
    // Each key the dialog prints resolves to its row's command.
    for (const binding of BINDINGS) {
      for (const press of binding.keys) {
        const event = key(press.key, { metaKey: Boolean(press.mod) });
        expect(shellHotkey(event, page)).toBe(binding.command);
      }
    }
  });

  it("lists every G letter under its page's name", () => {
    const go = groups(true).find((group) => group.title === "Go to");
    expect(go?.rows).toHaveLength(GO_BINDINGS.length);
    expect(go?.rows.find((row) => row.label === "My Tasks")?.keys).toEqual([["G", "T"]]);
    expect(go?.rows.find((row) => row.label === "Home")?.keys).toEqual([["G", "H"]]);
    expect(go?.rows.find((row) => row.label === "Settings")?.keys).toEqual([["G", "S"]]);
  });

  it("spells the modifier the way this platform does", () => {
    const find = (apple: boolean) =>
      groups(apple).flatMap((group) => group.rows).find((row) => row.label === "Find anything")?.keys;
    expect(find(true)).toEqual([["F"], ["/"], ["⌘", "K"]]);
    expect(find(false)).toEqual([["F"], ["/"], ["Ctrl", "K"]]);
    expect(isApplePlatform("MacIntel")).toBe(true);
    expect(isApplePlatform("iPhone")).toBe(true);
    expect(isApplePlatform("Win32")).toBe(false);
    expect(isApplePlatform("Linux x86_64")).toBe(false);
  });
});
