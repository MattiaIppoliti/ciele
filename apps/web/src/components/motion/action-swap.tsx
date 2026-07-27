"use client";

// beui.dev/components/motion/action-swap

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

export type ActionSwapAnimation = "roll" | "fade";

export interface ActionSwapTextProps {
  /** Changing this key swaps the rendered content. */
  value: string;
  animation?: ActionSwapAnimation;
  children: ReactNode;
  className?: string;
}

/**
 * Swaps a label in place when `value` changes: the outgoing text leaves and the
 * incoming one arrives in the same slot. `roll` moves them vertically through
 * the slot; `fade` cross-dissolves. Width is driven by the current child, so
 * callers should give the surrounding control room to breathe.
 *
 * The swap is decorative — screen readers get the live text either way, so
 * reduced motion collapses it to an instant cut.
 */
export function ActionSwapText({
  value,
  animation = "roll",
  children,
  className,
}: ActionSwapTextProps) {
  const reduce = useReducedMotion();
  const roll = animation === "roll" && !reduce;

  return (
    <span
      className={cn(
        "relative inline-grid overflow-hidden align-middle",
        className,
      )}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: roll ? "100%" : 0 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: roll ? "-100%" : 0 }}
          transition={{ duration: reduce ? 0 : 0.22, ease: EASE_OUT }}
          className="col-start-1 row-start-1 whitespace-nowrap"
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
