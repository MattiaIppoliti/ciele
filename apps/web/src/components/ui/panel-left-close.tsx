"use client";

import type { Variants, Transition } from "motion/react";
import { motion } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/create-animated-icon";

const DEFAULT_TRANSITION: Transition = {
  times: [0, 0.4, 1],
  duration: 0.5,
};

const PATH_VARIANTS: Variants = {
  normal: { x: 0 },
  animate: { x: [0, -1.5, 0] },
};

export const PanelLeftCloseIcon = createAnimatedIcon((controls, size) => (
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
    <rect height="18" rx="2" width="18" x="3" y="3" />
    <path d="M9 3v18" />
    <motion.path
      animate={controls}
      d="m16 15-3-3 3-3"
      transition={DEFAULT_TRANSITION}
      variants={PATH_VARIANTS}
    />
  </svg>
));
