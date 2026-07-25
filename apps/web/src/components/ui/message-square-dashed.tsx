"use client";

import type { Variants } from "motion/react";
import { motion } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/create-animated-icon";

const PATH_VARIANTS: Variants = {
  normal: { opacity: 1 },
  animate: (i: number) => ({
    opacity: [0, 1],
    transition: { delay: i * 0.1, duration: 0.3 },
  }),
};

export const MessageSquareDashedIcon = createAnimatedIcon((controls, size) => (
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
    {[
      "M14 3h1",
      "M14 17h1",
      "M10 17H7l-4 4v-7",
      "M9 3h1",
      "M19 3a2 2 0 0 1 2 2",
      "M3 9v1",
      "M21 9v1",
      "M21 14v1a2 2 0 0 1-2 2",
      "M5 3a2 2 0 0 0-2 2",
    ].map((d, index) => (
      <motion.path
        animate={controls}
        custom={index + 1}
        d={d}
        key={d}
        variants={PATH_VARIANTS}
      />
    ))}
  </svg>
));
