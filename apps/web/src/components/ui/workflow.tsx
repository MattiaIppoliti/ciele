"use client";

import type { Variants, Transition } from "motion/react";
import { motion } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/create-animated-icon";

const TRANSITION: Transition = {
  duration: 0.3,
  opacity: { delay: 0.15 },
};

const VARIANTS: Variants = {
  normal: {
    pathLength: 1,
    opacity: 1,
  },
  animate: (custom: number) => ({
    pathLength: [0, 1],
    opacity: [0, 1],
    transition: {
      ...TRANSITION,
      delay: 0.1 * custom,
    },
  }),
};

export const WorkflowIcon = createAnimatedIcon((controls, size) => (
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
    <motion.rect
      animate={controls}
      custom={0}
      height="8"
      rx="2"
      variants={VARIANTS}
      width="8"
      x="3"
      y="3"
    />
    <motion.path
      animate={controls}
      custom={3}
      d="M7 11v4a2 2 0 0 0 2 2h4"
      variants={VARIANTS}
    />
    <motion.rect
      animate={controls}
      custom={0}
      height="8"
      rx="2"
      variants={VARIANTS}
      width="8"
      x="13"
      y="13"
    />
  </svg>
));
