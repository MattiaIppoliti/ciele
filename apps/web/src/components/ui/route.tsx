"use client";

import type { Variants, Transition } from "motion/react";
import { motion } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/create-animated-icon";

const CIRCLE_TRANSITION: Transition = {
  duration: 0.3,
  delay: 0.1,
  opacity: { delay: 0.15 },
};

const CIRCLE_VARIANTS: Variants = {
  normal: {
    pathLength: 1,
    opacity: 1,
  },
  animate: {
    pathLength: [0, 1],
    opacity: [0, 1],
  },
};

export const RouteIcon = createAnimatedIcon((controls, size) => (
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
    <motion.circle
      animate={controls}
      cx="6"
      cy="19"
      r="3"
      transition={CIRCLE_TRANSITION}
      variants={CIRCLE_VARIANTS}
    />
    <motion.path
      animate={controls}
      d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"
      transition={{ duration: 0.7, delay: 0.5, opacity: { delay: 0.5 } }}
      variants={{
        normal: {
          pathLength: 1,
          opacity: 1,
          pathOffset: 0,
        },
        animate: {
          pathLength: [0, 1],
          opacity: [0, 1],
          pathOffset: [1, 0],
        },
      }}
    />
    <motion.circle
      animate={controls}
      cx="18"
      cy="5"
      r="3"
      transition={CIRCLE_TRANSITION}
      variants={CIRCLE_VARIANTS}
    />
  </svg>
));
