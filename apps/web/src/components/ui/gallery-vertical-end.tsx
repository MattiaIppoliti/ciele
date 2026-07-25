"use client";

import type { Variants } from "motion/react";
import { motion } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/create-animated-icon";

const PATH_VARIANTS: Variants = {
  normal: {
    translateY: 0,
    opacity: 1,
    transition: {
      type: "tween",
      stiffness: 200,
      damping: 13,
    },
  },
  animate: (i: number) => ({
    translateY: [2 * i, 0],
    opacity: [0, 1],
    transition: {
      delay: 0.25 * (2 - i),
      type: "tween",
      stiffness: 200,
      damping: 13,
    },
  }),
};

export const GalleryVerticalEndIcon = createAnimatedIcon((controls, size) => (
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
      custom={1}
      d="M7 2h10"
      variants={PATH_VARIANTS}
    />
    <motion.path
      animate={controls}
      custom={2}
      d="M5 6h14"
      variants={PATH_VARIANTS}
    />
    <rect height="12" rx="2" width="18" x="3" y="10" />
  </svg>
));
