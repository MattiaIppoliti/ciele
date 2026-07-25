"use client";

import { motion } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/create-animated-icon";

export const BookTextIcon = createAnimatedIcon((controls, size) => (
  <motion.svg
    animate={controls}
    fill="none"
    height={size}
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    variants={{
      animate: {
        scale: [1, 1.04, 1],
        rotate: [0, -8, 8, -8, 0],
        y: [0, -2, 0],
        transition: {
          duration: 0.6,
          ease: "easeInOut",
          times: [0, 0.2, 0.5, 0.8, 1],
        },
      },
      normal: {
        scale: 1,
        rotate: 0,
        y: 0,
      },
    }}
    viewBox="0 0 24 24"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
    <path d="M8 11h8" />
    <path d="M8 7h6" />
  </motion.svg>
));
