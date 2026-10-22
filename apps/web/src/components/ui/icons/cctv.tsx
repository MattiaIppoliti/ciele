"use client";

import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "ciele-animated-icons";

// The camera pans left, holds, pans right and comes home; its lens light
// blinks through the sweep.
const GROUP_VARIANTS: Variants = {
  normal: { rotate: 0, y: 0, x: 0 },
  animate: {
    rotate: [0, -20, -20, 15, 15, 0],
    y: [0, -0.5, -0.5, 0, 0, 0],
    x: [0, 0, 0, 0.5, 0.5, 0],
    transition: { duration: 1.8, ease: "easeInOut" },
  },
};

const LIGHT_VARIANTS: Variants = {
  normal: { opacity: 1 },
  animate: {
    opacity: [1, 0, 1, 0, 1, 0, 1],
    transition: { duration: 1.8, ease: "easeInOut" },
  },
};

/** Local Cctv glyph (Alerts: the platform watching its integrations). */
export const CctvIcon = createAnimatedIcon((controls, size) => (
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
    <motion.g animate={controls} initial="normal" variants={GROUP_VARIANTS}>
      <path d="M16.75 12h3.632a1 1 0 0 1 .894 1.447l-2.034 4.069a1 1 0 0 1-1.708.134l-2.124-2.97" />
      <path d="M17.106 9.053a1 1 0 0 1 .447 1.341l-3.106 6.211a1 1 0 0 1-1.342.447L3.61 12.3a2.92 2.92 0 0 1-1.3-3.91L3.69 5.6a2.92 2.92 0 0 1 3.92-1.3z" />
      <motion.path animate={controls} d="M7 9h.01" initial="normal" variants={LIGHT_VARIANTS} />
    </motion.g>
    <path d="M2 19h3.76a2 2 0 0 0 1.8-1.1L9 15" />
    <path d="M2 21v-4" />
  </svg>
));
