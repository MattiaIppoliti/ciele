"use client";

import type { Variants } from "motion/react";
import { motion } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/create-animated-icon";

const LINE_VARIANTS: Variants = {
  visible: { pathLength: 1, opacity: 1 },
  hidden: { pathLength: 0, opacity: 0 },
};

export const ChartNoAxesColumnIncreasingIcon = createAnimatedIcon(
  (controls, size) => (
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
        custom={0}
        d="M6 20v-4"
        initial="visible"
        variants={LINE_VARIANTS}
      />
      <motion.path
        animate={controls}
        custom={1}
        d="M12 20v-10"
        initial="visible"
        variants={LINE_VARIANTS}
      />
      <motion.path
        animate={controls}
        custom={2}
        d="M18 20v-16"
        initial="visible"
        variants={LINE_VARIANTS}
      />
    </svg>
  ),
);
