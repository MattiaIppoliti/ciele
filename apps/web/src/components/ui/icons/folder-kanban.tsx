"use client";

import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "ciele-animated-icons";

// The three columns drop back to nothing and grow down again in turn, like
// cards landing on a board.
const barVariants = (delay: number): Variants => ({
  normal: { pathLength: 1, transition: { duration: 0.2 } },
  animate: { pathLength: [1, 0, 1], transition: { duration: 0.6, delay, ease: "easeInOut" } },
});

/** Local FolderKanban glyph (Projects). */
export const FolderKanbanIcon = createAnimatedIcon((controls, size) => (
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
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    <motion.path animate={controls} d="M8 10v4" initial="normal" variants={barVariants(0)} />
    <motion.path animate={controls} d="M12 10v2" initial="normal" variants={barVariants(0.1)} />
    <motion.path animate={controls} d="M16 10v6" initial="normal" variants={barVariants(0.2)} />
  </svg>
));
