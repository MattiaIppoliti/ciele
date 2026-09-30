"use client";

import type { Variants } from "motion/react";
import { motion } from "motion/react";
import { createAnimatedIcon } from "ciele-animated-icons";

/**
 * The Inbox's mailbox: the flag swings up on hover, the "you have mail" signal.
 *
 * Lives here for the same reason as `telescope.tsx`: the lucide→animated
 * registry sits inside `ciele-animated-icons` and is closed to additions, so a
 * glyph authored in this tree goes through `createAnimatedIcon` and is reached
 * with `AnimatedGlyph`, which starts it from the nearest interactive ancestor.
 */

const FLAG_VARIANTS: Variants = {
  normal: {
    rotate: 0,
    transition: { type: "spring", stiffness: 300, damping: 18 },
  },
  animate: {
    rotate: -90,
    transition: { type: "spring", stiffness: 280, damping: 12, mass: 1 },
  },
};

export const MailboxIcon = createAnimatedIcon((controls, size) => (
  <svg
    className="overflow-visible"
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
    <path d="M22 17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9.5C2 7 4 5 6.5 5H18c2.2 0 4 1.8 4 4v8Z" />
    <motion.path
      animate={controls}
      d="M18 11V9H15"
      initial="normal"
      style={{ transformOrigin: "18px 11px" }}
      variants={FLAG_VARIANTS}
    />
    <path d="M6.5 5C9 5 11 7 11 9.5V17a2 2 0 0 1-2 2" />
    <line x1="6" x2="7" y1="10" y2="10" />
  </svg>
));
