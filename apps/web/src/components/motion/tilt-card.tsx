"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { usePointerSeen } from "@/lib/hooks/use-pointer-seen";
import { cn } from "@/lib/utils";

export interface TiltCardProps {
  children: ReactNode;
  /** Peak rotation in degrees at the far edges of the card. */
  max?: number;
  glare?: boolean;
  /**
   * Strength of the highlight. It is drawn in `--foreground`, so on a light
   * theme it reads as a grey wash, and it is painted at rest, not only while
   * the pointer is over the card. Turn it down on large, text-heavy surfaces.
   */
  glareOpacity?: number;
  /**
   * Flips both rotation axes. Upstream tips the edge under the pointer *away*
   * from the viewer; with `invert` that edge lifts toward the viewer instead,
   * so the card reads as being pressed down under the cursor rather than
   * pushed back by it.
   */
  invert?: boolean;
  className?: string;
}

/* The tilt is `motion/react`, and only a mouse can ever see it. Loaded on the
   first pointer movement (see `usePointerSeen`); until then, and forever on a
   touch device, the card is the same box without the rotation. */
const TiltCardMotion = dynamic(
  () => import("@/components/motion/tilt-card-motion").then((m) => m.TiltCard),
  { ssr: false }
);

/**
 * Tilts its contents towards the cursor, with a soft highlight tracking the
 * pointer. Decorative only: the tilt is skipped on touch devices (where hover
 * is phantom) and under `prefers-reduced-motion`, and the surface keeps working
 * either way.
 */
export function TiltCard(props: TiltCardProps) {
  const pointerSeen = usePointerSeen();

  if (pointerSeen) return <TiltCardMotion {...props} />;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl will-change-transform",
        props.className
      )}
    >
      {props.children}
    </div>
  );
}
