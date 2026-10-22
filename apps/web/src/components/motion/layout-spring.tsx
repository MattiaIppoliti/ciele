"use client";

import { motion, useReducedMotion } from "motion/react";
import { createContext, useContext, useEffect, useState, type ComponentProps, type RefObject } from "react";
import { SPRING_REFLOW } from "@/lib/ease";

/** The dependency a `SpringSpan` falls back to, for fields a grid renders through a shared component. */
export const SpringDependency = createContext<unknown>(undefined);

/**
 * A span that springs to its new place instead of jumping there. Motion only
 * measures when `dependency` changes, so pass whatever moves the layout (a
 * width, a column list); a render that leaves it alone costs no measurement.
 */
export function SpringSpan({
  dependency,
  ...props
}: Omit<ComponentProps<typeof motion.span>, "layout" | "layoutDependency" | "transition"> & {
  dependency?: unknown;
}) {
  const reduce = useReducedMotion();
  const inherited = useContext(SpringDependency);
  return (
    <motion.span
      layout={reduce ? false : "position"}
      layoutDependency={dependency ?? inherited}
      transition={reduce ? { duration: 0 } : SPRING_REFLOW}
      {...props}
    />
  );
}

/** An element's width, for a layout that changes through CSS alone (a container query). */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
