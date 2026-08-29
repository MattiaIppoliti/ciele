"use client";

import React from "react";
import dynamic from "next/dynamic";
import type { SpringOptions } from "motion/react";
import { usePointerSeen } from "@/lib/hooks/use-pointer-seen";

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
   first pointer movement (see `usePointerSeen`) and swapped in underneath the
   same children, the way the home cursor already does it. */
const MagneticPull = dynamic(
  () => import("./magnetic-motion").then((module) => module.Magnetic),
  { ssr: false }
);

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
