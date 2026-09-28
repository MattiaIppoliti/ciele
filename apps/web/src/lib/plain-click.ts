/** The fields of a mouse event that say whether a click was modified. */
type ClickLike = Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

/**
 * An unmodified primary-button click. Anything else (Cmd/Ctrl/Shift/Alt, a
 * middle click) is the browser opening a new tab or window, which a link
 * handler should leave alone.
 */
export function isPlainClick(event: ClickLike): boolean {
  return (
    event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
  );
}
