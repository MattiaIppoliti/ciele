"use client";
// motion-primitives Spotlight — a cursor-following radial glow that lights up
// its parent element (classic use: behind an inset card for a glowing
// border). https://motion-primitives.com

import {
  motion,
  useSpring,
  useTransform,
  type SpringOptions,
} from "motion/react";
import React, { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type SpotlightProps = {
  className?: string;
  size?: number;
  springOptions?: SpringOptions;
};

export function Spotlight({
  className,
  size = 200,
  springOptions = { bounce: 0 },
}: SpotlightProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [parentElement, setParentElement] = useState<HTMLElement | null>(null);

  const mouseX = useSpring(0, springOptions);
  const mouseY = useSpring(0, springOptions);

  const spotlightLeft = useTransform(mouseX, (x) => `${x - size / 2}px`);
  const spotlightTop = useTransform(mouseY, (y) => `${y - size / 2}px`);

  // Callback ref instead of the upstream useEffect: grabs the parent on mount
  // without a setState-in-effect (repo lint rule).
  const attachToParent = useCallback((node: HTMLDivElement | null) => {
    const parent = node?.parentElement ?? null;
    if (parent) {
      parent.style.position = "relative";
      parent.style.overflow = "hidden";
    }
    setParentElement(parent);
  }, []);

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!parentElement) return;
      const { left, top } = parentElement.getBoundingClientRect();
      mouseX.set(event.clientX - left);
      mouseY.set(event.clientY - top);
    },
    [mouseX, mouseY, parentElement]
  );

  useEffect(() => {
    if (!parentElement) return;

    const abortController = new AbortController();

    parentElement.addEventListener("mousemove", handleMouseMove, {
      signal: abortController.signal,
    });
    parentElement.addEventListener("mouseenter", () => setIsHovered(true), {
      signal: abortController.signal,
    });
    parentElement.addEventListener("mouseleave", () => setIsHovered(false), {
      signal: abortController.signal,
    });

    return () => {
      abortController.abort();
    };
  }, [parentElement, handleMouseMove]);

  return (
    <motion.div
      ref={attachToParent}
      className={cn(
        // Upstream uses bg-[radial-gradient(...,var(--tw-gradient-stops),...)],
        // which only works on Tailwind v3; v4 needs the bg-radial utility for
        // from-*/via-*/to-* stops to resolve.
        "bg-radial pointer-events-none absolute rounded-full to-80% blur-xl transition-opacity duration-200",
        "from-zinc-100 via-zinc-200 to-transparent dark:from-zinc-50 dark:via-zinc-100",
        isHovered ? "opacity-100" : "opacity-0",
        className
      )}
      style={{
        width: size,
        height: size,
        left: spotlightLeft,
        top: spotlightTop,
      }}
    />
  );
}
