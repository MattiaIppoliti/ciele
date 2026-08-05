"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { Spotlight } from "@/components/core/spotlight";
import { cn } from "@/lib/utils";

/** The block's own spring: short, barely bouncy, the same for every card. */
const SPRING = { type: "spring" as const, bounce: 0.1, duration: 0.25 };

/**
 * The home page's card treatment, shared by every marketing card grid: a
 * translucent grey rim drawn as a 1.5px inset behind an opaque face, lit by a
 * cursor-following spotlight that only shows through that rim. Defined once so
 * the feature pages and the security page cannot drift apart on hover.
 *
 * `index` staggers the scroll-in reveal; pass the position in the grid.
 */
export function SpotlightCard({
  index = 0,
  className,
  faceClassName,
  children,
}: {
  index?: number;
  className?: string;
  faceClassName?: string;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={cn(
        "relative overflow-hidden rounded-2xl bg-zinc-300/30 p-[1.5px] dark:bg-zinc-700/30",
        className,
      )}
      initial={reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.96 }}
      whileInView={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={reduceMotion ? { duration: 0 } : { ...SPRING, delay: index * 0.05 }}
    >
      <Spotlight
        className="from-sky-400 via-indigo-500 to-transparent blur-2xl dark:from-sky-300 dark:via-indigo-400"
        size={220}
      />
      <div
        className={cn(
          "bg-card relative flex h-full flex-col rounded-[calc(1rem-1.5px)] p-6",
          faceClassName,
        )}
      >
        {children}
      </div>
    </motion.div>
  );
}
