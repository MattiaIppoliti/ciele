"use client";

import type { Transition } from "motion/react";
import { motion } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/create-animated-icon";

const DEFAULT_TRANSITION: Transition = {
  type: "spring",
  stiffness: 200,
  damping: 16,
  mass: 1,
};

/**
 * Animated counterpart of lucide's `CreditCard`, the Billing tab's rail icon.
 *
 * The card tips as if handed over, and its magnetic stripe swipes across: two
 * motion elements on the one `controls` object, so the tilt and the swipe are a
 * single gesture rather than two animations that can drift apart.
 */
export const CreditCardIcon = createAnimatedIcon((controls, size) => (
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
    <motion.rect
      animate={controls}
      x="2"
      y="5"
      width="20"
      height="14"
      rx="2"
      style={{ transformOrigin: "12px 12px" }}
      transition={DEFAULT_TRANSITION}
      variants={{
        animate: { rotate: -7 },
        normal: { rotate: 0 },
      }}
    />
    <motion.line
      animate={controls}
      x1="2"
      x2="22"
      y1="10"
      y2="10"
      style={{ transformOrigin: "12px 12px" }}
      transition={DEFAULT_TRANSITION}
      variants={{
        animate: { rotate: -7, translateY: 2 },
        normal: { rotate: 0, translateY: 0 },
      }}
    />
  </svg>
));
