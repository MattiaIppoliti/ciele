"use client";

import { motion } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/create-animated-icon";

export const RotateCCWIcon = createAnimatedIcon((controls, size) => (
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
      animate: { rotate: "-50deg" },
    }}
    viewBox="0 0 24 24"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </motion.svg>
));
