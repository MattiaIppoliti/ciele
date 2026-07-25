"use client";

import { motion } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/create-animated-icon";

export const KeyIcon = createAnimatedIcon((controls, size) => (
  <motion.svg
    animate={controls}
    fill="none"
    height={size}
    initial="normal"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    style={{ originX: 0.3, originY: 0.7 }}
    variants={{
      normal: {
        rotate: 0,
        transition: {
          type: "spring",
          stiffness: 120,
          damping: 14,
          duration: 0.8,
        },
      },
      animate: {
        rotate: [-3, -33, -25, -28],
        transition: {
          duration: 0.6,
          times: [0, 0.6, 0.8, 1],
          ease: "easeInOut",
        },
      },
    }}
    viewBox="0 0 24 24"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
    <path d="m21 2-9.6 9.6" />
    <circle cx="7.5" cy="15.5" r="5.5" />
  </motion.svg>
));
