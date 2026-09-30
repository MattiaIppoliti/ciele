"use client";

import React from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { PanelContent } from "@/components/home/nav-panel";
import type { MenuItem } from "@/components/home/nav-menu";
import type { TriggerBounds } from "@/components/home/motion-navigation-menu";

/**
 * Shared viewport adapted from Unlumen's Motion Navigation Menu (Léo):
 * https://ui.unlumen.com/r/motion-navigation-menu.json
 *
 * Uses the existing motion/react dependency and Ciele's panel contents. The
 * content measures itself instead of rendering a second hidden copy of every
 * link. Its border is included in both dimensions of the spring target.
 */
const SPRING = { type: "spring", stiffness: 350, damping: 32, bounce: 0 } as const;
const contentVariants = {
  initial: (direction: number) => ({ x: `${100 * direction}%`, opacity: 0 }),
  active: { x: "0%", opacity: 1 },
  exit: (direction: number) => ({ x: `${-100 * direction}%`, opacity: 0 }),
};
const fadeVariants = {
  initial: { opacity: 0 },
  active: { opacity: 1 },
  exit: { opacity: 0 },
};

export function MotionNavigationMenuViewport({
  item,
  x,
  trigger,
  direction,
  open,
  panelId,
  labelledBy,
  onNavigate,
  cardRef,
  onMeasure,
}: {
  item: MenuItem | undefined;
  x: number;
  trigger: TriggerBounds | undefined;
  direction: number;
  open: boolean;
  panelId: string;
  labelledBy: string;
  onNavigate: () => void;
  cardRef: React.RefObject<HTMLDivElement | null>;
  onMeasure: (width: number) => void;
}) {
  const reduceMotion = useReducedMotion();
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const transition = reduceMotion
    ? { default: { duration: 0 }, opacity: { duration: 0.12 } }
    : SPRING;
  // The callback changes when a different trigger opens. Avoid restarting
  // measurement on position updates or feeding an observer/render loop.
  const measure = React.useEffectEvent(onMeasure);

  React.useEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      const next = { width: node.offsetWidth + 2, height: node.offsetHeight + 2 };
      setSize((current) => current.width === next.width && current.height === next.height ? current : next);
      measure(next.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <AnimatePresence>
        {trigger && (
          <motion.div
            aria-hidden
            data-slot="navigation-menu-highlight"
            className="bg-alpha-light pointer-events-none absolute left-0 top-0 rounded-xl"
            initial={{ ...trigger, opacity: 0 }}
            animate={{ ...trigger, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
          />
        )}
      </AnimatePresence>
      <motion.div
        aria-hidden={!open}
        inert={!open}
        data-nav-panel
        className="absolute left-0 top-full z-30"
        initial={false}
        animate={{ x }}
        transition={reduceMotion ? { duration: 0 } : SPRING}
        style={{ pointerEvents: open ? "auto" : "none" }}
      >
        {/* This padded hit area bridges the gap, including diagonal approaches.
            The centering transform stays outside the element whose width moves. */}
        <div className="-translate-x-1/2 px-8 pb-6 pt-3">
          <motion.div
            ref={cardRef}
            id={panelId}
            aria-labelledby={labelledBy}
            data-slot="navigation-menu-viewport"
            initial={reduceMotion ? { opacity: 0 } : { width: 0, height: 0, opacity: 0, scale: 0.95 }}
            animate={{
              width: open ? size.width || "auto" : reduceMotion ? size.width : 0,
              height: open ? size.height || "auto" : reduceMotion ? size.height : 0,
              opacity: open ? 1 : 0,
              scale: open || reduceMotion ? 1 : 0.95,
            }}
            transition={transition}
            className="bg-background/95 text-foreground relative overflow-hidden rounded-3xl border shadow-strong backdrop-blur-xl"
          >
            <div ref={bodyRef} className="w-max">
              <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                {item && (
                  <motion.div
                    data-slot="navigation-menu-content"
                    key={item.name}
                    custom={direction}
                    variants={reduceMotion ? fadeVariants : contentVariants}
                    initial="initial"
                    animate="active"
                    exit="exit"
                    transition={transition}
                  >
                    <PanelContent item={item} onNavigate={onNavigate} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </>
  );
}
