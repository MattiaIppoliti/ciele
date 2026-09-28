"use client";
// Vendored from beui, trimmed to what Ciele's callers use.

import { type RefObject, useEffect } from "react";

/**
 * Close an open overlay on Escape or a pointerdown outside `ref`. The tap
 * closes the overlay *and* activates whatever was under it (native popover
 * light-dismiss). Pass `null` for `ref` when what counts as inside isn't one
 * element, and say so with `ignore` instead.
 *
 * The pointerdown listener is capture-phase: a bubble-phase one is blinded by
 * any handler in between that stops propagation, and an overlay cannot know
 * what it is layered over. `onDismiss` and `ignore` must be stable (wrap in
 * useCallback) so the listeners aren't re-bound every render while open.
 */
export function useDismiss(
  open: boolean,
  onDismiss: () => void,
  ref: RefObject<HTMLElement | SVGElement | null> | null,
  {
    ignore,
  }: {
    /** Return true for an outside target that should *not* dismiss. Must be stable. */
    ignore?: (target: Element) => boolean;
  } = {},
) {
  useEffect(() => {
    if (!open) return;
    const inside = (target: Element) =>
      Boolean(ref?.current?.contains(target)) || Boolean(ignore?.(target));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target && !inside(target)) onDismiss();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open, onDismiss, ref, ignore]);
}
