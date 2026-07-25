"use client";

import { motion } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/create-animated-icon";

export const FileTextIcon = createAnimatedIcon((controls, size) => (
  <motion.svg
    animate={controls}
    fill="none"
    height={size}
    initial="normal"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    variants={{
      normal: { scale: 1 },
      animate: {
        scale: 1.05,
        transition: {
          duration: 0.3,
          ease: "easeOut",
        },
      },
    }}
    viewBox="0 0 24 24"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />

    <motion.path
      d="M10 9H8"
      stroke="currentColor"
      strokeWidth="2"
      variants={{
        normal: {
          pathLength: 1,
          x1: 8,
          x2: 10,
        },
        animate: {
          pathLength: [1, 0, 1],
          x1: [8, 10, 8],
          x2: [10, 10, 10],
          transition: {
            duration: 0.7,
            delay: 0.3,
          },
        },
      }}
    />
    <motion.path
      d="M16 13H8"
      stroke="currentColor"
      strokeWidth="2"
      variants={{
        normal: {
          pathLength: 1,
          x1: 8,
          x2: 16,
        },
        animate: {
          pathLength: [1, 0, 1],
          x1: [8, 16, 8],
          x2: [16, 16, 16],
          transition: {
            duration: 0.7,
            delay: 0.5,
          },
        },
      }}
    />
    <motion.path
      d="M16 17H8"
      stroke="currentColor"
      strokeWidth="2"
      variants={{
        normal: {
          pathLength: 1,
          x1: 8,
          x2: 16,
        },
        animate: {
          pathLength: [1, 0, 1],
          x1: [8, 16, 8],
          x2: [16, 16, 16],
          transition: {
            duration: 0.7,
            delay: 0.7,
          },
        },
      }}
    />
  </motion.svg>
));
