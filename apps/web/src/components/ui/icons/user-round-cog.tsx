"use client";

import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "ciele-animated-icons";

const COG_VARIANTS: Variants = {
  normal: { rotate: 0 },
  animate: { rotate: 180 },
};

/**
 * The animated UserRoundCog (lucide-animated), local like `telescope.tsx`: the
 * cog turns half a revolution on a soft spring.
 */
export const UserRoundCogIcon = createAnimatedIcon((controls, size) => (
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
    <path d="M2 21a8 8 0 0 1 10.434-7.62" />
    <circle cx="10" cy="8" r="5" />
    <motion.g
      animate={controls}
      initial="normal"
      transition={{ type: "spring", stiffness: 50, damping: 10 }}
      variants={COG_VARIANTS}
      style={{ transformOrigin: "18px 18px" }}
    >
      <circle cx="18" cy="18" r="3" />
      <path d="m14.305 19.53.923-.382" />
      <path d="m15.228 16.852-.923-.383" />
      <path d="m16.852 15.228-.383-.923" />
      <path d="m16.852 20.772-.383.924" />
      <path d="m19.148 15.228.383-.923" />
      <path d="m19.53 21.696-.382-.924" />
      <path d="m20.772 16.852.924-.383" />
      <path d="m20.772 19.148.924.383" />
    </motion.g>
  </svg>
));
