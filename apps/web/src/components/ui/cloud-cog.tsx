"use client";

import type { Variants } from "motion/react";
import { motion } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/create-animated-icon";

const G_VARIANTS: Variants = {
  normal: { rotate: 0 },
  animate: { rotate: 180 },
};

export const CloudCogIcon = createAnimatedIcon((controls, size) => (
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
      transition={{ type: "spring", stiffness: 50, damping: 10 }}
      variants={G_VARIANTS}
    >
      <path d="m9.2 15.9-.9-.4" />
      <path d="m9.2 18.1-.9.4" />
      <path d="m10.9 14.2-.4-.9" />
      <path d="m10.9 19.8-.4.9" />
      <path d="m13.5 13.3-.4.9" />
      <path d="m13.5 20.7-.4-.9" />
      <path d="m15.7 15.5-.9.4" />
      <path d="m15.7 18.5-.9-.4" />
      <circle cx="12" cy="17" r="3" />
    </motion.g>
  </svg>
));
