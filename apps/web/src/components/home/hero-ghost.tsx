"use client";

import { useEffect, useRef } from "react";
import { GhostMark } from "@/components/auth/ghost-mark";

/* Hero mascot whose eyes follow the cursor. The pupils translate a few SVG
   user-units toward the pointer, clamped so they stay inside the eye sockets.
   Falls back to a static gaze when the visitor prefers reduced motion. */
export function HeroGhost({ className }: { className?: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const eyesRef = useRef<SVGGElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Max pupil travel (SVG units, viewBox is 212×186) and how far the cursor
    // has to be before the gaze maxes out. The pupils are drawn right-of-centre
    // on the face (their centre ≈117.5 vs the body centre ≈106), so at rest
    // there is more white to their left. Rightward travel hits the near edge
    // quickly (reads strongly); leftward needs more range to read as an equal
    // glance, hence the asymmetric horizontal maxima.
    const MAX_RIGHT = 6;
    const MAX_LEFT = 15;
    const MAX_Y = 6;
    const RAMP = 220;

    // The browser already coalesces pointermove to ~display rate, and the CSS
    // transition on the eyes smooths the steps, so we write straight to the
    // attribute, no rAF (which pauses when the tab is backgrounded).
    const onMove = (e: PointerEvent) => {
      const svg = svgRef.current;
      const eyes = eyesRef.current;
      if (!svg || !eyes) return;
      const r = svg.getBoundingClientRect();
      // Eyes sit slightly right of, and near, the SVG's vertical middle.
      const cx = r.left + r.width * 0.55;
      const cy = r.top + r.height * 0.5;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const ramp = Math.min(dist, RAMP) / RAMP;
      const nx = dx / dist;
      const ny = dy / dist;
      const tx = nx * ramp * (nx < 0 ? MAX_LEFT : MAX_RIGHT);
      const ty = ny * ramp * MAX_Y;
      eyes.setAttribute("transform", `translate(${tx.toFixed(2)} ${ty.toFixed(2)})`);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return (
    <GhostMark
      className={className}
      svgRef={svgRef}
      eyesRef={eyesRef}
      eyesClassName="transition-transform duration-150 ease-out"
    />
  );
}
