"use client";
// motion-primitives Cursor, a custom cursor that follows the pointer with a
// spring. https://motion-primitives.com

import {
  AnimatePresence,
  motion,
  type SpringOptions,
  type Transition,
  useMotionValue,
  useSpring,
  type Variant,
} from "motion/react";
import React, { useEffect } from "react";

export type CursorProps = {
  children: React.ReactNode;
  springConfig: SpringOptions;
  transition: Transition;
  variants: {
    initial: Variant;
    animate: Variant;
    exit: Variant;
  };
  onPositionChange: (x: number, y: number) => void;
  /**
   * The caller owns whether the cursor shows. Toggling it from the parent's
   * own `mouseenter`/`mouseleave` got the cursor stuck hidden after a portaled
   * overlay (dialog) stole the pointer, or on first paint when the pointer was
   * already inside the parent and no `mouseenter` ever fired.
   */
  visible: boolean;
};

export function Cursor({
  children,
  springConfig,
  variants,
  transition,
  onPositionChange,
  visible,
}: CursorProps) {
  const cursorX = useMotionValue(0);
  const cursorY = useMotionValue(0);

  useEffect(() => {
    if (typeof window !== "undefined") {
      cursorX.set(window.innerWidth / 2);
      cursorY.set(window.innerHeight / 2);
    }
  }, [cursorX, cursorY]);

  useEffect(() => {
    const controller = new AbortController();

    document.addEventListener(
      "mousemove",
      (event) => {
        cursorX.set(event.clientX);
        cursorY.set(event.clientY);
        onPositionChange(event.clientX, event.clientY);
      },
      { signal: controller.signal }
    );

    return () => controller.abort();
  }, [cursorX, cursorY, onPositionChange]);

  const cursorXSpring = useSpring(cursorX, springConfig);
  const cursorYSpring = useSpring(cursorY, springConfig);

  return (
    <motion.div
      className="pointer-events-none fixed left-0 top-0 z-50"
      style={{
        x: cursorXSpring,
        y: cursorYSpring,
        translateX: "-50%",
        translateY: "-50%",
      }}
    >
      <AnimatePresence>
        {visible && (
          <motion.div
            initial="initial"
            animate="animate"
            exit="exit"
            variants={variants}
            transition={transition}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
