"use client";

import type { Variants } from "motion/react";
import { motion } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/create-animated-icon";

const PATH_VARIANTS: Variants = {
  normal: { opacity: 1 },
  animate: (i: number) => ({
    opacity: [0, 1],
    transition: { delay: i * 0.1, duration: 0.3 },
  }),
};

export const SunIcon = createAnimatedIcon((controls, size) => (
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
    <circle cx="12" cy="12" r="4" />
    {[
      "M12 3v1",
      "M12 20v1",
      "M3 12h1",
      "M20 12h1",
      "m18.364 5.636-.707.707",
      "m6.343 17.657-.707.707",
      "m5.636 5.636.707.707",
      "m17.657 17.657.707.707",
    ].map((d, index) => (
      <motion.path
        animate={controls}
        custom={index + 1}
        d={d}
        key={d}
        variants={PATH_VARIANTS}
      />
    ))}
  </svg>
));
