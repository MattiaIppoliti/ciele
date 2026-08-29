"use client";

import React from "react";

/* Has a pointer moved over this page yet?
 *
 * The seam for every animation that only a mouse can see: the magnetic pull on
 * a CTA, the spotlight glow on a card. Each is drawn by `motion/react`, and a
 * page that loads it up front pays for it whether or not anyone has a pointer
 * at all. The answer arrives one movement later, which is before the effect
 * could have been perceived.
 *
 * One listener and one flag per page, at module scope: a marketing page renders
 * a dozen of these between the header and a card grid, and the first movement
 * should arm all of them at once, not schedule a dozen imports.
 */
let seen = false;
const listeners = new Set<() => void>();

function arm() {
  if (seen) return;
  seen = true;
  for (const notify of listeners) notify();
}

export function usePointerSeen(): boolean {
  React.useEffect(() => {
    if (seen) return;
    // Touch devices never see either effect, so they never load one.
    if (!window.matchMedia("(pointer: fine)").matches) return;
    window.addEventListener("pointermove", arm, { once: true, passive: true });
    return () => window.removeEventListener("pointermove", arm);
  }, []);

  return React.useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    () => seen,
    // The server has seen no pointer either, so both renders agree.
    () => false
  );
}
