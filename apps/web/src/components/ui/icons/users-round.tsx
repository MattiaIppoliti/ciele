"use client";

import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "ciele-animated-icons";

// The second figure's shoulder draws in from behind the first on hover: a
// help desk is people standing behind the assistant.
const PATH_VARIANTS: Variants = {
  normal: {
    translateX: 0,
    opacity: 1,
    transition: { type: "spring", stiffness: 200, damping: 13 },
  },
  animate: {
    translateX: [-4, 0],
    opacity: [0, 1],
    transition: { delay: 0.1, type: "spring", stiffness: 200, damping: 13 },
  },
};

/** Local UsersRound glyph (Help Desks) until it is added to the animated-icon package. */
export const UsersRoundIcon = createAnimatedIcon((controls, size) => (
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
    <path d="M18 21a8 8 0 0 0-16 0" />
    <circle cx="10" cy="8" r="5" />
    <motion.path
      animate={controls}
      d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"
      initial="normal"
      variants={PATH_VARIANTS}
    />
  </svg>
));
