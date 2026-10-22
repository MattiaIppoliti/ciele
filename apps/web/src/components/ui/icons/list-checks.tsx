"use client";

import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "ciele-animated-icons";

// Each tick redraws, the top one first, as if the list were being worked down.
const tickVariants = (delay: number): Variants => ({
  normal: { opacity: 1, pathLength: 1, transition: { duration: 0.3, opacity: { duration: 0.1 } } },
  animate: {
    opacity: [0, 1],
    pathLength: [0, 1],
    transition: { duration: 0.35, delay, opacity: { duration: 0.1, delay } },
  },
});

/** Local ListChecks glyph (All tasks). */
export const ListChecksIcon = createAnimatedIcon((controls, size) => (
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
    <path d="M13 5h8" />
    <path d="M13 12h8" />
    <path d="M13 19h8" />
    <motion.path animate={controls} d="m3 7 2 2 4-4" initial="normal" variants={tickVariants(0)} />
    <motion.path animate={controls} d="m3 17 2 2 4-4" initial="normal" variants={tickVariants(0.15)} />
  </svg>
));
