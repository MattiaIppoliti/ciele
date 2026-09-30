/**
 * The shell's keyboard shortcuts, as one pure decision: which command a key
 * press means, or null to leave it to the page. The provider only listens and
 * performs, so the rules are testable without a DOM.
 */

export type ShellCommand = "find" | "newChat" | "developerPanel";

export interface HotkeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** The event came from a text box, where a bare letter is typing. */
  typing: boolean;
}

export function shellHotkey(
  event: HotkeyEvent,
  page: { pageHasApiDomains: boolean }
): ShellCommand | null {
  const key = event.key.toLowerCase();
  const chord = event.metaKey || event.ctrlKey;
  // A modifier chord is never typing, so these two work from a text box too.
  if (chord && key === "k") return "find";
  // Cmd/Ctrl+O: New chat, the sidebar button's shortcut (Notion's).
  if (chord && !event.shiftKey && !event.altKey && key === "o") return "newChat";
  if (chord || event.altKey || event.typing) return null;
  if (key === "f") return "find";
  // `D` means something only where the page has a programmatic surface.
  if (key === "d" && page.pageHasApiDomains) return "developerPanel";
  return null;
}
