"use client";

import React from "react";
import { motion, useMotionValue, useSpring, type SpringOptions } from "motion/react";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export type MagneticProps = {
  children: React.ReactNode;
  intensity?: number;
  range?: number;
  /** Maximum offset in pixels the element may travel from its resting position. */
  maxOffset?: number;
  springOptions?: SpringOptions;
};

export function Magnetic({
  children,
  intensity = 0.6,
  range = 100,
  maxOffset = 14,
  springOptions = { stiffness: 26.7, damping: 4.1, mass: 0.2 },
}: MagneticProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, springOptions);
  const springY = useSpring(y, springOptions);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function handleMouseMove(e: MouseEvent) {
      const { left, top, width, height } = el!.getBoundingClientRect();
      const centerX = left + width / 2;
      const centerY = top + height / 2;
      const distance = Math.sqrt((e.clientX - centerX) ** 2 + (e.clientY - centerY) ** 2);

      if (distance < range) {
        const offsetX = clamp((e.clientX - centerX) * intensity, -maxOffset, maxOffset);
        const offsetY = clamp((e.clientY - centerY) * intensity, -maxOffset, maxOffset);
        x.set(offsetX);
        y.set(offsetY);
      } else {
        x.set(0);
        y.set(0);
      }
    }

    function handleMouseLeave() {
      x.set(0);
      y.set(0);
    }

    window.addEventListener("mousemove", handleMouseMove);
    el.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      el.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [intensity, range, maxOffset, x, y]);

  return (
    <motion.div ref={ref} style={{ x: springX, y: springY }} className="inline-block">
      {children}
    </motion.div>
  );
}
