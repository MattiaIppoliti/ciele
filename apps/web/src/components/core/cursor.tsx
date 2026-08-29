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
import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type CursorProps = {
  children: React.ReactNode;
  className?: string;
  springConfig?: SpringOptions;
  attachToParent?: boolean;
  transition?: Transition;
  variants?: {
    initial: Variant;
    animate: Variant;
    exit: Variant;
  };
  onPositionChange?: (x: number, y: number) => void;
  /**
   * Controlled visibility. When provided, the caller owns whether the cursor
   * shows, and the internal parent `mouseenter`/`mouseleave` toggling is
   * bypassed, this avoids the cursor getting stuck hidden after a portaled
   * overlay (dialog) steals the pointer, or on first paint when the pointer is
   * already inside the parent and no `mouseenter` ever fires.
   */
  visible?: boolean;
};

export function Cursor({
  children,
  className,
  springConfig,
  attachToParent,
  variants,
  transition,
  onPositionChange,
  visible,
}: CursorProps) {
  const cursorX = useMotionValue(0);
  const cursorY = useMotionValue(0);
  const cursorRef = useRef<HTMLDivElement>(null);
  const controlled = visible !== undefined;
  const [internalVisible, setInternalVisible] = useState(!attachToParent);
  const isVisible = controlled ? visible : internalVisible;

  useEffect(() => {
    if (typeof window !== "undefined") {
      cursorX.set(window.innerWidth / 2);
      cursorY.set(window.innerHeight / 2);
    }
  }, [cursorX, cursorY]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    if (!attachToParent) {
      document.body.style.cursor = "none";
    }

    document.addEventListener(
      "mousemove",
      (event) => {
        cursorX.set(event.clientX);
        cursorY.set(event.clientY);
        onPositionChange?.(event.clientX, event.clientY);
      },
      { signal }
    );

    return () => {
      controller.abort();
      if (!attachToParent) document.body.style.cursor = "auto";
    };
  }, [attachToParent, cursorX, cursorY, onPositionChange]);

  useEffect(() => {
    // When visibility is controlled by the caller, don't wire the parent
    // hover listeners, the caller decides when the cursor shows.
    if (!attachToParent || controlled) return;
    const parent = cursorRef.current?.parentElement;
    if (!parent) return;

    const controller = new AbortController();
    parent.addEventListener(
      "mouseenter",
      () => {
        parent.style.cursor = "none";
        setInternalVisible(true);
      },
      { signal: controller.signal }
    );
    parent.addEventListener(
      "mouseleave",
      () => {
        parent.style.cursor = "auto";
        setInternalVisible(false);
      },
      { signal: controller.signal }
    );

    return () => {
      controller.abort();
      parent.style.cursor = "auto";
    };
  }, [attachToParent, controlled]);

  const cursorXSpring = useSpring(cursorX, springConfig || { duration: 0 });
  const cursorYSpring = useSpring(cursorY, springConfig || { duration: 0 });

  return (
    <motion.div
      ref={cursorRef}
      className={cn("pointer-events-none fixed left-0 top-0 z-50", className)}
      style={{
        x: cursorXSpring,
        y: cursorYSpring,
        translateX: "-50%",
        translateY: "-50%",
      }}
    >
      <AnimatePresence>
        {isVisible && (
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
