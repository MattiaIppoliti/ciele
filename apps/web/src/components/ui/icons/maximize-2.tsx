"use client";

import { motion } from "motion/react";
import { createAnimatedIcon } from "ciele-animated-icons";

/**
 * "Open full screen": two corner arrows that push apart on hover, which is the
 * gesture the control performs.
 *
 * Same factory and the same reason for living here as `folders.tsx` and
 * `arrow-up-right.tsx`: `ciele-animated-icons` ships from its own repository, so
 * a glyph authored in this tree stays here until a release of that package moves
 * it, and the behaviour is identical either way.
 *
 * Reach it through `AnimatedGlyph`, never with its own hover listeners: this one
 * sits inside a dropdown menu item and inside a 32px icon button, and the
 * animation has to start when the pointer enters *those*, not the glyph.
 */

const SPRING = { type: "spring" as const, stiffness: 250, damping: 25 };

/** Bottom-left corner: leaves towards its own corner. */
const LOWER_VARIANTS = {
  normal: { translateX: 0, translateY: 0 },
  animate: { translateX: -2, translateY: 2 },
};

/** Top-right corner: the opposite way, so the pair reads as one expansion. */
const UPPER_VARIANTS = {
  normal: { translateX: 0, translateY: 0 },
  animate: { translateX: 2, translateY: -2 },
};

export const Maximize2Icon = createAnimatedIcon((controls, size) => (
  <svg
    fill="none"
    height={size}
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <motion.path
      animate={controls}
      d="M3 16.2V21m0 0h4.8M3 21l6-6"
      initial="normal"
      transition={SPRING}
      variants={LOWER_VARIANTS}
    />
    <motion.path
      animate={controls}
      d="M21 7.8V3m0 0h-4.8M21 3l-6 6"
      initial="normal"
      transition={SPRING}
      variants={UPPER_VARIANTS}
    />
  </svg>
));
