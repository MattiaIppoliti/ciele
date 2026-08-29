"use client";

import { motion } from "motion/react";
import { createAnimatedIcon } from "ciele-animated-icons";

/**
 * The Project glyph (#771): two stacked folders that separate on hover, the
 * front one sliding down-left while the one behind it slides away and fades.
 *
 * Built with the same `createAnimatedIcon` factory every glyph in
 * `ciele-animated-icons` uses, but it lives here rather than there because that
 * package is published from its own repository; moving it across is a release
 * of the package, not an edit in this tree. Behaviour is identical either way,
 * so the move is a file rename when it happens.
 */

const SPRING = { type: "spring" as const, stiffness: 250, damping: 25 };

/** The front folder: steps down and to the left, revealing the one behind. */
const FRONT_VARIANTS = {
  normal: { translateX: 0, translateY: 0 },
  animate: { translateX: -2, translateY: 2 },
};

/**
 * The folder behind it, drawn as the open corner. It slides the opposite way
 * and fades, so the pair reads as one folder being pulled out of a stack
 * rather than as two shapes drifting apart.
 */
const BACK_VARIANTS = {
  normal: { translateX: 0, translateY: 0, opacity: 1, scale: 1 },
  animate: { translateX: 2, translateY: -2, opacity: 0, scale: 0.9 },
};

export const FoldersIcon = createAnimatedIcon((controls, size) => (
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
      d="M20 17a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.9a2 2 0 0 1-1.69-.9l-.81-1.2a2 2 0 0 0-1.67-.9H8a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2Z"
      initial="normal"
      transition={SPRING}
      variants={FRONT_VARIANTS}
    />
    <motion.path
      animate={controls}
      d="M2 8v11a2 2 0 0 0 2 2h14"
      initial="normal"
      transition={SPRING}
      variants={BACK_VARIANTS}
    />
  </svg>
));
