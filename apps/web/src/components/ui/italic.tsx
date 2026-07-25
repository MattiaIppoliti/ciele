"use client";

import type { Variants } from "motion/react";
import { motion } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/create-animated-icon";

const LINE_VARIANTS: Variants = {
  normal: { pathLength: 1, opacity: 1, pathOffset: 0 },
  animate: {
    pathLength: [0, 1],
    opacity: [0, 1],
    pathOffset: [1, 0],
  },
};

export const ItalicIcon = createAnimatedIcon((controls, size) => (
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
    <motion.line
      animate={controls}
      transition={{ duration: 0.2 }}
      variants={LINE_VARIANTS}
      x1="19"
      x2="10"
      y1="4"
      y2="4"
    />
    <motion.line
      animate={controls}
      transition={{ duration: 0.2 }}
      variants={LINE_VARIANTS}
      x1="14"
      x2="5"
      y1="20"
      y2="20"
    />
    <motion.line
      animate={controls}
      transition={{
        delay: 0.1,
        duration: 0.4,
      }}
      variants={{
        normal: { pathLength: 1, pathOffset: 0 },
        animate: {
          pathLength: [0, 1],
          pathOffset: [1, 0],
        },
      }}
      x1="15"
      x2="9"
      y1="4"
      y2="20"
    />
  </svg>
));
