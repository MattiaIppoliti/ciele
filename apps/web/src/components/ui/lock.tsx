"use client";

import { motion } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/create-animated-icon";

export const LockIcon = createAnimatedIcon((controls, size) => (
  <motion.svg
    animate={controls}
    fill="none"
    height={size}
    initial="normal"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    transition={{
      duration: 1,
      ease: [0.4, 0, 0.2, 1],
    }}
    variants={{
      normal: {
        rotate: 0,
        scale: 1,
      },
      animate: {
        rotate: [-3, 1, -2, 0],
        scale: [0.95, 1.05, 0.98, 1],
      },
    }}
    viewBox="0 0 24 24"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect height="11" rx="2" ry="2" width="18" x="3" y="11" />
    <motion.path
      animate={controls}
      d="M7 11V7a5 5 0 0 1 10 0v4"
      initial="normal"
      transition={{
        duration: 0.3,
        ease: [0.4, 0, 0.2, 1],
      }}
      variants={{
        normal: {
          pathLength: 1,
        },
        animate: {
          pathLength: 0.7,
        },
      }}
    />
  </motion.svg>
));
