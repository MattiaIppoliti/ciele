"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/** The sound preference drives the glyph, so hover never disguises a muted device. */
export function VolumeIcon({ muted, size = 22 }: { muted: boolean; size?: number }) {
  const reduce = useReducedMotion();
  return (
    <svg
      aria-hidden="true"
      className="block shrink-0"
      fill="none"
      height={size}
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
      <AnimatePresence initial={false} mode="wait">
        <motion.g
          key={muted ? "muted" : "active"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.15 }}
        >
          {muted ? (
            <>
              <line x1="22" x2="16" y1="9" y2="15" />
              <line x1="16" x2="22" y1="9" y2="15" />
            </>
          ) : (
            <>
              <path d="M16 9a5 5 0 0 1 0 6" />
              <path d="M19.364 18.364a9 9 0 0 0 0-12.728" />
            </>
          )}
        </motion.g>
      </AnimatePresence>
    </svg>
  );
}
