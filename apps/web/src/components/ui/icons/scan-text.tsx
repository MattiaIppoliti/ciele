"use client";

import { motion, useAnimation, useReducedMotion, type Variants } from "motion/react";
import type { LucideProps } from "lucide-react";
import { forwardRef, useCallback, type MouseEvent } from "react";

const FRAME_VARIANTS: Variants = {
  visible: { opacity: 1 },
  hidden: { opacity: 1 },
};

const LINE_VARIANTS: Variants = {
  visible: { pathLength: 1, opacity: 1 },
  hidden: { pathLength: 0, opacity: 0 },
};

/** A text scan glyph used wherever the console refers to saved memory. */
export const ScanTextIcon = forwardRef<SVGSVGElement, LucideProps>(
      (
        { size = 24, strokeWidth = 2, onMouseEnter, onMouseLeave, ...props },
        ref,
      ) => {
    const controls = useAnimation();
    const reduceMotion = useReducedMotion() ?? false;

    const handleMouseEnter = useCallback(
      async (event: MouseEvent<SVGSVGElement>) => {
        onMouseEnter?.(event);
        if (reduceMotion) return;

        await controls.start((index) => ({
          pathLength: 0,
          opacity: 0,
          transition: { delay: Number(index) * 0.1, duration: 0.3 },
        }));
        await controls.start((index) => ({
          pathLength: 1,
          opacity: 1,
          transition: { delay: Number(index) * 0.1, duration: 0.3 },
        }));
      },
      [controls, onMouseEnter, reduceMotion],
    );

    const handleMouseLeave = useCallback(
      (event: MouseEvent<SVGSVGElement>) => {
        onMouseLeave?.(event);
        if (!reduceMotion) void controls.start("visible");
      },
      [controls, onMouseLeave, reduceMotion],
    );

    return (
      <svg
        ref={ref}
        fill="none"
        height={size}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
        viewBox="0 0 24 24"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        {...props}
      >
        <motion.path d="M3 7V5a2 2 0 0 1 2-2h2" variants={FRAME_VARIANTS} />
        <motion.path d="M17 3h2a2 2 0 0 1 2 2v2" variants={FRAME_VARIANTS} />
        <motion.path d="M21 17v2a2 2 0 0 1-2 2h-2" variants={FRAME_VARIANTS} />
        <motion.path d="M7 21H5a2 2 0 0 1-2-2v-2" variants={FRAME_VARIANTS} />
        {["M7 8h8", "M7 12h10", "M7 16h6"].map((path, index) => (
          <motion.path
            key={path}
            animate={controls}
            custom={index}
            d={path}
            initial="visible"
            variants={LINE_VARIANTS}
          />
        ))}
      </svg>
    );
  },
);

ScanTextIcon.displayName = "ScanTextIcon";
