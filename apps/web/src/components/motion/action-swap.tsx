"use client";

import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { EASE_OUT, EASE_OUT_CSS, SPRING_SWAP } from "@/lib/ease";
import { cn } from "@/lib/utils";

export interface ActionSwapTextProps {
  value: string;
  children: ReactNode;
  className?: string;
}

const ROLL_BLUR = "blur(3px)";

const ROLL_VARIANTS: Variants = {
  initial: { opacity: 0, y: "90%", filter: ROLL_BLUR },
  animate: {
    opacity: 1,
    y: "0%",
    filter: "blur(0px)",
    transition: SPRING_SWAP,
  },
  exit: {
    opacity: 0,
    y: "-90%",
    filter: ROLL_BLUR,
    transition: { duration: 0.14, ease: EASE_OUT },
  },
};

/** Rolls the new label up into place when `value` changes. */
export function ActionSwapText({ value, children, className }: ActionSwapTextProps) {
  const reduce = useReducedMotion();
  const measureRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number>();

  useLayoutEffect(() => {
    const nextWidth = measureRef.current?.offsetWidth;
    if (!nextWidth) return;
    setWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
  });

  return (
    <span
      className={cn("relative inline-block overflow-hidden whitespace-nowrap align-bottom", className)}
      style={{
        width,
        transition: reduce ? undefined : `width 220ms ${EASE_OUT_CSS}`,
      }}
    >
      <span
        ref={measureRef}
        aria-hidden
        className="invisible inline-block whitespace-nowrap"
      >
        {children}
      </span>
      <AnimatePresence initial={false}>
        <motion.span
          key={`roll-${value}`}
          variants={ROLL_VARIANTS}
          initial={reduce ? false : "initial"}
          animate={reduce ? { opacity: 1, filter: "blur(0px)", scale: 1, y: 0 } : "animate"}
          exit={reduce ? undefined : "exit"}
          className="absolute left-0 top-0 inline-block will-change-[opacity,filter,transform]"
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
