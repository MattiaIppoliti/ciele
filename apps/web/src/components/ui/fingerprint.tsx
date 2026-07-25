"use client";

import type { Variants } from "motion/react";
import { motion } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/create-animated-icon";

const PATH_VARIANTS: Variants = {
  normal: { pathLength: 1, opacity: 1 },
  animate: {
    opacity: [0, 0, 1, 1, 1],
    pathLength: [0.1, 0.3, 0.5, 0.7, 0.9, 1],
    transition: {
      opacity: { duration: 0.5 },
      pathLength: {
        duration: 2,
      },
    },
  },
};

export const FingerprintIcon = createAnimatedIcon((controls, size) => (
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
    <path
      d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"
      fill="none"
      strokeOpacity={0.4}
      strokeWidth="2"
    />
    <motion.path
      animate={controls}
      d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"
      variants={PATH_VARIANTS}
    />

    <path
      d="M14 13.12c0 2.38 0 6.38-1 8.88"
      fill="none"
      strokeOpacity={0.4}
      strokeWidth="2"
    />
    <motion.path
      animate={controls}
      d="M14 13.12c0 2.38 0 6.38-1 8.88"
      variants={PATH_VARIANTS}
    />

    <path
      d="M17.29 21.02c.12-.6.43-2.3.5-3.02"
      fill="none"
      strokeOpacity={0.4}
      strokeWidth="2"
    />
    <motion.path
      animate={controls}
      d="M17.29 21.02c.12-.6.43-2.3.5-3.02"
      variants={PATH_VARIANTS}
    />

    <path
      d="M2 12a10 10 0 0 1 18-6"
      fill="none"
      strokeOpacity={0.4}
      strokeWidth="2"
    />
    <motion.path
      animate={controls}
      d="M2 12a10 10 0 0 1 18-6"
      variants={PATH_VARIANTS}
    />

    <path d="M2 16h.01" fill="none" strokeOpacity={0.4} strokeWidth="2" />
    <motion.path animate={controls} d="M2 16h.01" variants={PATH_VARIANTS} />

    <path
      d="M21.8 16c.2-2 .131-5.354 0-6"
      fill="none"
      strokeOpacity={0.4}
      strokeWidth="2"
    />
    <motion.path
      animate={controls}
      d="M21.8 16c.2-2 .131-5.354 0-6"
      variants={PATH_VARIANTS}
    />

    <path
      d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"
      fill="none"
      strokeOpacity={0.4}
      strokeWidth="2"
    />
    <motion.path
      animate={controls}
      d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"
      variants={PATH_VARIANTS}
    />

    <path
      d="M8.65 22c.21-.66.45-1.32.57-2"
      fill="none"
      strokeOpacity={0.4}
      strokeWidth="2"
    />
    <motion.path
      animate={controls}
      d="M8.65 22c.21-.66.45-1.32.57-2"
      variants={PATH_VARIANTS}
    />

    <path
      d="M9 6.8a6 6 0 0 1 9 5.2v2"
      fill="none"
      strokeOpacity={0.4}
      strokeWidth="2"
    />
    <motion.path
      animate={controls}
      d="M9 6.8a6 6 0 0 1 9 5.2v2"
      variants={PATH_VARIANTS}
    />
  </svg>
));
