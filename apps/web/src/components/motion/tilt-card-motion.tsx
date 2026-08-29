"use client";
// beui.dev/components/motion/tilt-card

import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react";
import { useRef } from "react";
import { SPRING_MOUSE } from "@/lib/ease";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable";
import { cn } from "@/lib/utils";

import type { TiltCardProps } from "@/components/motion/tilt-card";

/**
 * The tilt itself. Split from `tilt-card.tsx` so `motion/react` arrives with
 * the first pointer movement rather than with the page: the effect is a
 * fine-pointer flourish, skipped on touch and under `prefers-reduced-motion`,
 * and the card reads identically without it.
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
