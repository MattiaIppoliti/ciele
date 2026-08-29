"use client";

import { motion } from "motion/react";
import { createAnimatedIcon } from "ciele-animated-icons";

/**
 * "Go in there": the open-in arrow on a Teammate card and on a group card.
 *
 * On hover the arrow pulls back towards its own corner and springs out again.
 * `originX: 1, originY: 0` is what makes that read as a departure rather than a
 * wobble: the arrowhead is the fixed point, so the tail retracts into it.
 *
 * Written with the `createAnimatedIcon` factory every glyph in
 * `ciele-animated-icons` uses, for the reason `folders.tsx` gives: the package
 * ships from its own repository, so a glyph authored here stays here until a
 * release of that package moves it, and the behaviour is identical either way.
 *
 * Deliberately **not** its own hover listeners. Reach it through `AnimatedGlyph`,
 * which drives it from the nearest interactive ancestor: the arrow sits inside a
 * link that fills the card's right edge, and an icon that only animated when the
 * pointer crossed the 16px glyph itself would miss most of the hover it is
 * feedback for. That wrapper also leaves it still under `prefers-reduced-motion`.
 */

const ARROW_VARIANTS = {
  normal: { scale: 1, translateX: 0, translateY: 0 },
  animate: {
    scale: [1, 0.85, 1],
    translateX: [0, -4, 0],
    translateY: [0, 4, 0],
    originX: 1,
    originY: 0,
    transition: { duration: 0.5, ease: "easeInOut" as const },
  },
};

export const ArrowUpRightIcon = createAnimatedIcon((controls, size) => (
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
    {/* One group, so the shaft and the two head strokes move as one arrow.
        Drawn 4..20 rather than the 7..17 a diagonal arrow is usually given: at
        16px beside a lucide eye and pencil, which both span the box edge to
        edge, a glyph filling 10 of 24 units read as a smaller icon than its
        neighbours rather than as the same icon pointing diagonally. */}
    <motion.g animate={controls} initial="normal" variants={ARROW_VARIANTS}>
      <path d="M4 4H20" />
      <path d="M20 4V20" />
      <path d="M4 20L20 4" />
    </motion.g>
  </svg>
));
