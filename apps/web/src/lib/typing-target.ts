/**
 * Whether a keyboard event landed in a field, where a bare-key shortcut is a
 * character the Member is typing. Every single-key console shortcut checks it
 * before acting.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}
