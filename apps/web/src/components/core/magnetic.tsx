"use client";

import React from "react";
import dynamic from "next/dynamic";
import type { SpringOptions } from "motion/react";

export type MagneticProps = {
  children: React.ReactNode;
  intensity?: number;
  range?: number;
  /** Maximum offset in pixels the element may travel from its resting position. */
  maxOffset?: number;
  springOptions?: SpringOptions;
};

/* The magnetic pull is drawn by `motion/react`, which outweighs every
   marketing page's own JavaScript put together, and only a visitor moving a
   mouse can ever see it: it is inert on touch, and nothing about the button's
   layout or behaviour depends on it. So the implementation is fetched on the
   first pointer movement on a fine-pointer device and swapped in underneath
   the same children, the way the home cursor already does it (see
   home-cursor-mount.tsx). */
const MagneticPull = dynamic(
  () => import("./magnetic-motion").then((module) => module.Magnetic),
  { ssr: false }
);

/* One listener and one flag for every instance on the page (the header alone
   renders three), so the first movement arms all of them at once. */
let pointerSeen = false;
const listeners = new Set<() => void>();

function arm() {
  if (pointerSeen) return;
  pointerSeen = true;
  for (const notify of listeners) notify();
}

function usePointerSeen() {
  React.useEffect(() => {
    if (pointerSeen) return;
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
    () => pointerSeen,
    // The server has seen no pointer either, so both renders agree.
    () => false
  );
}

/**
 * A button (or any child) that leans toward a nearby pointer.
 *
 * Renders its children in the same inline box whether or not the animation
 * module has arrived, so the only thing the swap changes is whether the box
 * can move.
 */
export function Magnetic(props: MagneticProps) {
  const armed = usePointerSeen();

  if (!armed) return <div className="inline-block">{props.children}</div>;
  return <MagneticPull {...props} />;
}
