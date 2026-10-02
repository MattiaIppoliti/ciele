"use client";

import { useRef, useSyncExternalStore } from "react";
import { useInView } from "motion/react";
import { Squishmoji } from "@usespaceui/squishmoji/react";
import { SQUISHMOJI_OPTIONS } from "@/lib/avatar-generator";

function subscribeToMotionPreference(onChange: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function AnimatedAvatar({ seed }: { seed: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const visible = useInView(ref);
  const reducedMotion = useSyncExternalStore(subscribeToMotionPreference, prefersReducedMotion, () => true);
  const animate = visible && !reducedMotion;
  return (
    <span ref={ref} className="size-full" data-avatar-playing={animate}>
      <Squishmoji
        {...SQUISHMOJI_OPTIONS}
        seed={seed}
        size="100%"
        className="size-full"
        animate={animate}
        // The frozen clock also stops the frame loop when off-screen.
        frozenAt={animate ? undefined : 0}
      />
    </span>
  );
}
