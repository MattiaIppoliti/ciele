import type { NavId } from "./nav";

/**
 * The shell's keyboard shortcuts, as one pure decision: which command a key
 * press means, or null to leave it to the page. The provider only listens and
 * performs, so the rules are testable without a DOM.
 *
 * Two kinds of binding (#1052, #1071). A single key or a chord answers at
 * once. `G` starts a sequence: the next letter within `SEQUENCE_WINDOW_MS`
 * goes to a page. The sequence never shadows a single key it does not use, so
 * `F` and `D` still open Find and the Developer Panel right after a `G`.
 * Nothing bare fires while the Member is typing.
 *
 * Both tables below are the whole truth: the resolver reads them and the `?`
 * dialog is generated from them, so the dialog cannot list a key that does
 * nothing, or miss one that does something.
 */

export type ShellCommand =
  | "find"
  | "newChat"
  | "developerPanel"
  | "shortcuts"
  | "toggleSidebar"
  | "newTask"
  | "newProject"
  | "submit"
  | { go: NavId };

export interface HotkeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** The event came from a text box, where a bare letter is typing. */
  typing: boolean;
}

/** How long a `G` waits for its second key. */
export const SEQUENCE_WINDOW_MS = 1200;

/** One way to press a binding: a key, alone or with the platform's modifier. */
export interface KeyPress {
  /** A letter, a symbol as the layout produces it (`?`, `[`), or a key name (`Enter`). */
  key: string;
  /** Cmd on macOS, Ctrl elsewhere; either is accepted on any platform. */
  mod?: true;
}

export interface Binding {
  command: Exclude<ShellCommand, { go: NavId }>;
  /** Every way to press it: the resolver accepts each, the dialog lists each. */
  keys: readonly KeyPress[];
  label: string;
  group: "General" | "Create";
  /** Answers only where the page has a Developer Panel. */
  needsPanel?: true;
}

export const BINDINGS: readonly Binding[] = [
  {
    command: "find",
    keys: [{ key: "f" }, { key: "/" }, { key: "k", mod: true }],
    label: "Find anything",
    group: "General",
  },
  { command: "shortcuts", keys: [{ key: "?" }], label: "Keyboard shortcuts", group: "General" },
  { command: "toggleSidebar", keys: [{ key: "[" }], label: "Show or hide the sidebar", group: "General" },
  // Notion's chord for the sidebar's New chat button.
  { command: "newChat", keys: [{ key: "o", mod: true }], label: "New chat", group: "General" },
  {
    command: "developerPanel",
    keys: [{ key: "d" }],
    label: "Developer Panel, on pages that have one",
    group: "General",
    needsPanel: true,
  },
  { command: "newTask", keys: [{ key: "n" }], label: "New task", group: "Create" },
  { command: "newProject", keys: [{ key: "p" }], label: "New project", group: "Create" },
  {
    command: "submit",
    keys: [{ key: "Enter", mod: true }],
    label: "Submit the form or the text you are writing",
    group: "Create",
  },
];

/** `G` then `letter` opens `go`; `label` only where the sidebar names the page differently. */
export interface GoBinding {
  letter: string;
  go: NavId;
  label?: string;
}

/**
 * `G` then a letter, exactly the table #1052 decided: Home, the work views,
 * Inbox, Settings and Notifications. Home is `/`, which the sidebar's top row
 * calls Home and the nav entry Assistants. `F` and `D` are never targets,
 * because a second key is still a key and those two already mean something on
 * their own; the letters #1052 leaves out stay unbound on purpose.
 */
export const GO_BINDINGS: readonly GoBinding[] = [
  { letter: "h", go: "assistants", label: "Home" },
  { letter: "t", go: "my-tasks" },
  { letter: "p", go: "projects" },
  { letter: "a", go: "tasks" },
  { letter: "i", go: "inbox" },
  { letter: "s", go: "settings" },
  { letter: "n", go: "notifications" },
];

/** A `G` waiting for its second key, or nothing. */
export type PendingSequence = { startedAt: number } | null;

const NONE = { command: null, pending: null } as const;

const isLetter = (key: string) => /^[a-z]$/i.test(key);

function bindingFor(press: (key: KeyPress) => boolean, page: { pageHasApiDomains: boolean }): ShellCommand | null {
  const binding = BINDINGS.find((candidate) => candidate.keys.some(press));
  if (!binding || (binding.needsPanel && !page.pageHasApiDomains)) return null;
  return binding.command;
}

export function resolveHotkey(
  event: HotkeyEvent,
  page: { pageHasApiDomains: boolean },
  pending: PendingSequence,
  now: number
): { command: ShellCommand | null; pending: PendingSequence } {
  const key = event.key.toLowerCase();
  // Windows reports AltGr as Ctrl+Alt, and AltGr is how an Italian or German
  // keyboard types `[`. That press produced a character, so it is read as the
  // character; a Ctrl or Cmd chord without Alt is still a chord.
  const altGraph = event.ctrlKey && event.altKey && !event.metaKey;
  const chord = !altGraph && (event.metaKey || event.ctrlKey);
  if (chord) {
    // A chord is never typing, so these work from a text box too. Shift or
    // Alt on top makes it some other chord, which belongs to the page.
    if (event.shiftKey || event.altKey) return NONE;
    const command = bindingFor((press) => Boolean(press.mod) && press.key.toLowerCase() === key, page);
    return { command, pending: null };
  }
  if (event.typing) return NONE;

  if (!isLetter(event.key)) {
    // A symbol is whatever the layout produced. Shift, Option or AltGr may be
    // how this keyboard types it (`?` is Shift+/ on one, Shift+' on another),
    // so the modifiers are not held against it.
    return { command: bindingFor((press) => !press.mod && press.key === event.key, page), pending: null };
  }
  // A letter with Shift or Alt held is a different character, or a chord.
  if (event.shiftKey || event.altKey) return NONE;

  // The second key of a live sequence, ahead of the single letters, so G N
  // and G P go to a page instead of creating something.
  const target = GO_BINDINGS.find((binding) => binding.letter === key);
  if (pending && now - pending.startedAt <= SEQUENCE_WINDOW_MS && target) {
    return { command: { go: target.go }, pending: null };
  }
  if (key === "g") return { command: null, pending: { startedAt: now } };
  return { command: bindingFor((press) => !press.mod && press.key === key, page), pending: null };
}

/** The single-press half, for callers with no sequence to keep. */
export function shellHotkey(event: HotkeyEvent, page: { pageHasApiDomains: boolean }): ShellCommand | null {
  return resolveHotkey(event, page, null, 0).command;
}

/** Whether `navigator.platform` names an Apple keyboard, whose modifier is ⌘. */
export function isApplePlatform(platform: string): boolean {
  return /Mac|iPhone|iPad/.test(platform);
}

/** One row of the `?` dialog: the keys as they are pressed, and what they do. */
export interface ShortcutRow {
  keys: string[][];
  label: string;
}

/** A press as the dialog spells it, with this platform's modifier. */
function spell(press: KeyPress, apple: boolean): string[] {
  const key = isLetter(press.key) ? press.key.toUpperCase() : press.key;
  return press.mod ? [apple ? "⌘" : "Ctrl", key] : [key];
}

/**
 * What the `?` dialog shows, generated from the two tables above. `names`
 * gives each page its sidebar label; `apple` picks ⌘ or Ctrl.
 */
export function shortcutGroups(
  names: (id: NavId) => string,
  { apple }: { apple: boolean }
): { title: string; rows: ShortcutRow[] }[] {
  const groups = (["General", "Create"] as const).map((title) => ({
    title,
    rows: BINDINGS.filter((binding) => binding.group === title).map((binding) => ({
      keys: binding.keys.map((press) => spell(press, apple)),
      label: binding.label,
    })),
  }));
  return [
    ...groups,
    {
      title: "Go to",
      rows: GO_BINDINGS.map((binding) => ({
        keys: [["G", binding.letter.toUpperCase()]],
        label: binding.label ?? names(binding.go),
      })),
    },
  ];
}

/** What the window hears when the shell asks the page to create something. */
export const SHELL_CREATE_EVENT = "ciele:create";
export type ShellCreateKind = "task" | "project";

/**
 * Asks the open page to create a Task or a Project. A page that can opens its
 * own dialog and calls `preventDefault`; when none does, the shell goes to a
 * page that can, with `?new=` telling it to open the dialog at once.
 */
export function requestCreate(kind: ShellCreateKind): boolean {
  const event = new CustomEvent<ShellCreateKind>(SHELL_CREATE_EVENT, { detail: kind, cancelable: true });
  return !window.dispatchEvent(event);
}
