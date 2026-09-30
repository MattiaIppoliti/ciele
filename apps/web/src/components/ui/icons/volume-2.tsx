"use client";

import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "ciele-animated-icons";

// The two sound waves pulse out from the speaker in turn, the near one first.
const waveVariants = (delay: number): Variants => ({
  normal: { opacity: 1, transition: { duration: 0.2 } },
  animate: {
    opacity: [1, 0.2, 1],
    transition: { duration: 0.7, delay, ease: "easeInOut" },
  },
});

/** Local Volume2 glyph (Sounds) until it is added to the animated-icon package. */
export const Volume2Icon = createAnimatedIcon((controls, size) => (
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
    <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
    <motion.path
      animate={controls}
      d="M16 9a5 5 0 0 1 0 6"
      initial="normal"
      variants={waveVariants(0)}
    />
    <motion.path
      animate={controls}
      d="M19.364 18.364a9 9 0 0 0 0-12.728"
      initial="normal"
      variants={waveVariants(0.15)}
    />
  </svg>
));
