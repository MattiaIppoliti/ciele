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
    // Touch devices and visitors asking for reduced motion never see either
    // effect, so don't load the animation chunk for them. Keep the media
    // listeners so changing either preference can arm the next real pointer
    // movement without requiring a reload.
    const pointer = window.matchMedia("(pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let listening = false;

    const onPointerMove = () => arm();
    const update = () => {
      const shouldListen = pointer.matches && !reducedMotion.matches;
      if (shouldListen && !listening) {
        window.addEventListener("pointermove", onPointerMove, {
          once: true,
          passive: true,
        });
        listening = true;
      } else if (!shouldListen && listening) {
        window.removeEventListener("pointermove", onPointerMove);
        listening = false;
      }
    };

    update();
    pointer.addEventListener("change", update);
    reducedMotion.addEventListener("change", update);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      pointer.removeEventListener("change", update);
      reducedMotion.removeEventListener("change", update);
    };
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
