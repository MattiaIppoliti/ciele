/**
 * Whether a surface should focus its primary input as it opens.
 *
 * Only with a fine pointer: on a touch screen, focusing a field opens the
 * on-screen keyboard over the very list the Member opened the popover to see.
 * Safe to call during render, because `autoFocus` is never serialized into
 * server HTML (React focuses on mount), so the server's `false` cannot cause a
 * hydration mismatch.
 */
export function canAutoFocus(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(pointer: fine)").matches;
}
