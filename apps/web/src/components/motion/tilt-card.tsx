"use client";
// beui.dev/components/motion/tilt-card

import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react";
import { useRef, type ReactNode } from "react";
import { SPRING_MOUSE } from "@/lib/ease";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable";
import { cn } from "@/lib/utils";

export interface TiltCardProps {
  children: ReactNode;
  /** Peak rotation in degrees at the far edges of the card. */
  max?: number;
  glare?: boolean;
  /**
   * Strength of the highlight. It is drawn in `--foreground`, so on a light
   * theme it reads as a grey wash — and it is painted at rest, not only while
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

/**
 * Tilts its contents towards the cursor, with a soft highlight tracking the
 * pointer. Decorative only: the tilt is skipped on touch devices (where hover
 * is phantom) and under `prefers-reduced-motion`, and the surface keeps working
 * either way.
 */
export function TiltCard({
  children,
  max = 12,
  glare = true,
  glareOpacity = 0.15,
  invert = false,
  className,
}: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const canHover = useHoverCapable();
  const enabled = !reduce && canHover;
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const gx = useMotionValue(50);
  const gy = useMotionValue(50);

  const srx = useSpring(rx, SPRING_MOUSE);
  const sry = useSpring(ry, SPRING_MOUSE);

  const onMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const element = ref.current;
    if (!element || !enabled) return;
    const rect = element.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    // CSS `rotateX` is right-handed about the +X axis and +Y points down, so a
    // positive angle brings the BOTTOM edge toward the viewer. Upstream's
    // `0.5 - py` therefore pushes whichever edge the pointer is near away;
    // `invert` swaps both axes so it comes forward instead.
    const direction = invert ? -1 : 1;
    ry.set((px - 0.5) * max * direction);
    rx.set((0.5 - py) * max * direction);
    gx.set(px * 100);
    gy.set(py * 100);
  };

  const onLeave = () => {
    rx.set(0);
    ry.set(0);
  };

  const transform = useMotionTemplate`perspective(1000px) rotateX(${srx}deg) rotateY(${sry}deg)`;
  const glareBg = useMotionTemplate`radial-gradient(circle at ${gx}% ${gy}%, var(--foreground), transparent 50%)`;

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ transform, transformStyle: "preserve-3d" }}
      className={cn(
        "relative overflow-hidden rounded-2xl will-change-transform",
        className
      )}
    >
      {children}
      {/* `rounded-[inherit]` rather than relying on the wrapper's clip: callers
          that carry a ring or shadow have to turn `overflow-hidden` off (it
          would clip an outward ring away), and the highlight still has to stop
          at the corners when they do. */}
      {glare && enabled ? (
        <motion.div
          aria-hidden
          style={{ background: glareBg, opacity: glareOpacity }}
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
        />
      ) : null}
    </motion.div>
  );
}
