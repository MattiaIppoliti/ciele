"use client";

import type { Transition } from "motion/react";
import { motion } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/create-animated-icon";

const DEFAULT_TRANSITION: Transition = {
  type: "spring",
  stiffness: 160,
  damping: 17,
  mass: 1,
};

export const GaugeIcon = createAnimatedIcon((controls, size) => (
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
      d="m12 14 4-4"
      transition={DEFAULT_TRANSITION}
      variants={{
        animate: { translateX: 0.5, translateY: 3, rotate: 72 },
        normal: {
          translateX: 0,
          rotate: 0,
          translateY: 0,
        },
      }}
    />
    <path d="M3.34 19a10 10 0 1 1 17.32 0" />
  </svg>
));
