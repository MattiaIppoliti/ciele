"use client";

import React from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { PanelContent } from "@/components/home/nav-panel";
import type { MenuItem } from "@/components/home/nav-menu";

/**
 * The marketing nav's shared dropdown panel: the card that glides between
 * triggers, morphs to each menu's size and cross-slides its contents.
 *
 * Its own module because it is the header's only use of `motion/react`, and it
 * cannot appear before a visitor points at the nav. The header loads it lazily
 * on that first pointer (see `home-header.tsx`), which is what keeps ~70 KB
 * gzip of animation library out of every public page's first load.
 */

/** The panel card's own border, top plus bottom (Tailwind `border` = 1px). */
const PANEL_BORDER = 2;

/* Motion values of the directional-hover header the panel's movement is copied
   from: the contents cross-slide by CONTENT_X, and the rows inside stagger
   against the pointer's travel (see nav-panel). */
const PANEL_EASE = [0.16, 1, 0.3, 1] as const;
const CONTENT_X = 84;
/** Panel height tween (open, close and every swap between two panels). */
const HEIGHT_DURATION = 0.28;

/**
 * One panel shared by every dropdown (resend.com-style): it slides along the
 * nav to sit under the open trigger and morphs to that panel's size, while the
 * contents cross-slide, outgoing leaves toward the previous trigger, incoming
 * enters from the new one. `direction` is +1 when moving right along the nav.
 *
 * The caller keeps the last opened item rendering while the panel closes, so
 * closing fades out rather than collapsing to nothing first.
 */
export function DropdownPanel({
  item,
  x,
  direction,
  open,
  onNavigate,
  cardRef,
}: {
  item: MenuItem | undefined;
  x: number;
  direction: number;
  open: boolean;
  onNavigate: () => void;
  cardRef: React.RefObject<HTMLDivElement | null>;
}) {
  const reduceMotion = useReducedMotion();
  /* Cross-slide the way the reference header does it: moving right along the
     nav (direction +1) brings the new panel in from the right and pushes the
     old one out to the left. */
  const slide = reduceMotion ? 0 : CONTENT_X * direction;
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const [height, setHeight] = React.useState<number | "auto">("auto");

  /* The card tweens to each panel's height instead of snapping. Measured off
     the body (`popLayout` pulls the outgoing panel out of flow, so this is the
     incoming panel's height), not animated with `layout`, that measures
     through the `-translate-x-1/2` ancestor and pinned the width. */
  React.useEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      /* +PANEL_BORDER: the measurement is the body's content box, the card it
         is applied to is border-box. Without it the card lands 2px short, and a
         promo tile stretched to fill it then sits 8px from the top and 6px from
         the bottom, which a concentric corner shows up immediately. */
      setHeight(entry.contentRect.height + PANEL_BORDER)
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      aria-hidden={!open}
      data-nav-panel
      className="absolute left-0 top-full z-30"
      initial={false}
      animate={{ x, opacity: open ? 1 : 0, y: open ? 0 : -6 }}
      transition={{
        x: { type: "spring", stiffness: 420, damping: 40, mass: 0.7 },
        default: { duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] },
      }}
      style={{ pointerEvents: open ? "auto" : "none" }}
    >
      {/* Transparent padding around the card is the hit area that makes the
          panel reachable: pt-4 bridges the visible gap under the trigger, and
          px-8/pb-6 catch a diagonal approach that overshoots the card's edge.
          The centering translate lives here, on the padded box, so the card
          still lines up with the trigger. */}
      <div className="-translate-x-1/2 px-8 pb-6 pt-4">
        {/* Sized by its content, not by a layout animation. `layout` measures
            through its ancestors, and this card sits inside a `-translate-x-1/2`
            box, so it kept the previous panel's width: the Docs icon grid
            spilled out over the page. The panel still slides and cross-fades. */}
        <motion.div
          ref={cardRef}
          animate={{ height }}
          transition={{
            duration: reduceMotion ? 0 : HEIGHT_DURATION,
            ease: PANEL_EASE,
          }}
          className="bg-background/95 relative w-max overflow-hidden rounded-3xl border shadow-2xl shadow-black/10 backdrop-blur-xl dark:shadow-black/40"
        >
          <div ref={bodyRef}>
            {/* popLayout pulls the outgoing panel out of flow, so the card
                resizes to the incoming one instead of stretching to fit both. */}
            <AnimatePresence mode="popLayout" initial={false}>
              {item && (
                <motion.div
                  key={item.name}
                  initial={{ opacity: 0, x: slide }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -slide }}
                  transition={{
                    x: { duration: reduceMotion ? 0 : 0.26, ease: PANEL_EASE },
                    opacity: { duration: reduceMotion ? 0 : 0.16, ease: "easeOut" },
                  }}
                >
                  <PanelContent
                    item={item}
                    direction={direction}
                    onNavigate={onNavigate}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

