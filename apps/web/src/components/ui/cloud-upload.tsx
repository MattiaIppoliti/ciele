"use client";

import type { Variants } from "motion/react";
import { motion } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/create-animated-icon";

const CLOUD_VARIANTS: Variants = {
  initial: { y: -2 },
  active: { y: 0 },
};

export const CloudUploadIcon = createAnimatedIcon((controls, size) => (
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
    <path d="M4.2 15.1A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.2" />
    <motion.g
      animate={controls}
      transition={{
        duration: 0.3,
        ease: [0.68, -0.6, 0.32, 1.6],
      }}
      variants={CLOUD_VARIANTS}
    >
      <path d="M12 13v8" />
      <path d="m8 17 4-4 4 4" />
    </motion.g>
  </svg>
));
