"use client";

import type { Variants } from "motion/react";
import { motion } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/create-animated-icon";

const WINDOW_VARIANTS: Variants = {
  normal: {
    opacity: 1,
  },
  animate: (custom: number) => ({
    opacity: [0, 1],
    transition: {
      duration: 0.3,
      ease: "linear",
      delay: 0.1 + custom * 0.15,
    },
  }),
};

const WINDOWS = [
  { path: "M6.75 12.75h.75", index: 0 },
  { path: "M6.75 9.75h.75", index: 1 },
  { path: "M6.75 6.75h.75", index: 2 },
  { path: "M10.5 12.75h.75", index: 0 },
  { path: "M10.5 9.75h.75", index: 1 },
  { path: "M10.5 6.75h.75", index: 2 },
  { path: "M17.25 17h.008v.008h-.008v-.008Z", index: 0 },
  { path: "M17.25 14h.008v.008h-.008v-.008Z", index: 1 },
  { path: "M17.25 11h.008v.008h-.008v-.008Z", index: 2 },
] as const;

export const BuildingOffice2Icon = createAnimatedIcon((controls, size) => (
  <svg
    fill="none"
    height={size}
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.5"
    viewBox="0 0 24 24"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21" />
    {WINDOWS.map((window, index) => {
      return (
        <motion.path
          animate={controls}
          custom={window.index}
          d={window.path}
          initial="normal"
          key={`${window.path}-${index}`}
          variants={WINDOW_VARIANTS}
        />
      );
    })}
  </svg>
));
