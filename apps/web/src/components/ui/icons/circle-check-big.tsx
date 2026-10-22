"use client";

import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "ciele-animated-icons";

// The tick draws itself in, the way the package's CircleCheck does.
const TICK_VARIANTS: Variants = {
  normal: { opacity: 1, pathLength: 1, transition: { duration: 0.3, opacity: { duration: 0.1 } } },
  animate: { opacity: [0, 1], pathLength: [0, 1], transition: { duration: 0.4, opacity: { duration: 0.1 } } },
};

/** Local CircleCheckBig glyph (My Tasks). */
export const CircleCheckBigIcon = createAnimatedIcon((controls, size) => (
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
    <path d="M21.801 10A10 10 0 1 1 17 3.335" />
    <motion.path animate={controls} d="m9 11 3 3L22 4" initial="normal" variants={TICK_VARIANTS} />
  </svg>
));
