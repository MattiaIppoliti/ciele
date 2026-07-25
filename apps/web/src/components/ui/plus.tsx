"use client";

import { motion } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/create-animated-icon";

export const PlusIcon = createAnimatedIcon((controls, size) => (
  <motion.svg
    animate={controls}
    fill="none"
    height={size}
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    transition={{ duration: 0.3, ease: "easeOut" }}
    variants={{
      normal: {
        scale: 1,
      },
      animate: {
        scale: [1, 1.25, 1],
      },
    }}
    viewBox="0 0 24 24"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </motion.svg>
));
