"use client";

import { motion } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/create-animated-icon";

export const RotateCWIcon = createAnimatedIcon((controls, size) => (
  <motion.svg
    animate={controls}
    fill="none"
    height={size}
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    transition={{ type: "spring", stiffness: 250, damping: 25 }}
    variants={{
      normal: { rotate: "0deg" },
      animate: { rotate: "50deg" },
    }}
    viewBox="0 0 24 24"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </motion.svg>
));
