"use client";

import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "ciele-animated-icons";

const EYES = {
  normal: { y1: 13, y2: 15 },
  animate: {
    y1: [13, 14, 13],
    y2: [15, 14, 15],
    transition: { duration: 0.5, ease: "easeInOut", delay: 0.2 },
  },
} satisfies Variants;

export const BotIcon = createAnimatedIcon((controls, size) => (
  <svg
    fill="none"
    height={size}
    width={size}
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M12 8V4H8" />
    <rect height="12" rx="2" width="16" x="4" y="8" />
    <path d="M2 14h2" />
    <path d="M20 14h2" />
    {[15, 9].map((x) => (
      <motion.line
        key={x}
        animate={controls}
        initial="normal"
        variants={EYES}
        x1={x}
        x2={x}
      />
    ))}
  </svg>
));

BotIcon.displayName = "Bot";
