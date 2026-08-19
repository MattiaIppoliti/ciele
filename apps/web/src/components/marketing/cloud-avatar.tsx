"use client";

import { useEffect, useId, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";

/* How far the pupils may travel (SVG user units, the viewBox is 250 wide)
   and how far the cursor must be for the gaze to max out (screen px). */
const MAX_GAZE = 7;
const RAMP = 240;

/**
 * Renders one generated bloub SVG inline and makes its eyes follow the
 * cursor. The gaze is a translate on the `.bloub-gaze` group wrapping each
 * eye, applied via the `--bloub-gaze-x/y` CSS variables, so it composes with
 * the SVG's own baked keyframes (blinks, drift) instead of replacing them.
 * Touch devices and reduced-motion visitors keep the baked animation only.
 */
export function CloudAvatar({
  svg,
  className,
}: {
  svg: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // The callout renders the same SVG twice (mobile + desktop variants), and a
  // mask id duplicated into a display:none subtree stops resolving, so every
  // instance gets its own mask id.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const html = useMemo(
    () => svg.replace(/bloub-mask-[a-z]+/g, (m) => `${m}-${uid}`),
    [svg, uid],
  );

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = ref.current;
    if (!el) return;

    // The browser coalesces pointermove to ~display rate and the SVG's own
    // 150ms transition smooths the steps, write straight to the vars, no rAF.
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      // The responsive variants render only one copy at a time; the hidden
      // one has no box and must not steer the gaze.
      if (r.width === 0) return;
      // The eyes sit in the upper half of the cloud.
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height * 0.4;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const ramp = Math.min(dist, RAMP) / RAMP;
      const gaze = ramp * MAX_GAZE;
      el.style.setProperty("--bloub-gaze-x", `${((dx / dist) * gaze).toFixed(2)}px`);
      el.style.setProperty("--bloub-gaze-y", `${((dy / dist) * gaze).toFixed(2)}px`);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return (
    // Decorative mascot: hidden from the accessibility tree.
    <div
      ref={ref}
      aria-hidden="true"
      // aspect-square gives the 100%-sized inner <svg> a definite height
      // (the export's viewBox is square).
      className={cn("pointer-events-none aspect-square select-none", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
