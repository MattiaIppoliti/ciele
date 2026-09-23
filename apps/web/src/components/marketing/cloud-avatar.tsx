"use client";

import { useEffect, useId, useRef, useState } from "react";
import { bloubSvgUrl, type CloudExpression } from "@/components/marketing/bloub";
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
 *
 * It takes the expression, not the markup. Handed the ~17 kB SVG string as a
 * prop it cost every marketing document that string twice, once serialized
 * into the RSC payload and once rendered into the HTML, so the face is fetched
 * from `public/bloub/` instead and the payload carries a nine-character word.
 * The mascot therefore appears after hydration rather than in the first paint,
 * which is the trade: it is decorative and `aria-hidden`, the box is reserved
 * by `aspect-square` so nothing shifts when it lands, and the file is cached
 * across the whole site after the first page that draws it.
 */
export function CloudAvatar({
  expression,
  className,
}: {
  expression: CloudExpression;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string | null>(null);

  // A mask id duplicated into another subtree stops resolving, so every
  // instance rewrites the ids in its own copy.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  useEffect(() => {
    let live = true;
    fetch(bloubSvgUrl(expression))
      .then((response) => (response.ok ? response.text() : null))
      .then((svg) => {
        if (!live || !svg) return;
        setHtml(svg.replace(/bloub-mask-[a-z]+/g, (id) => `${id}-${uid}`));
      })
      // Decorative: a face that does not arrive leaves an empty box, which is
      // not worth an error boundary or a retry.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [expression, uid]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = ref.current;
    if (!el) return;

    // The browser coalesces pointermove to ~display rate and the SVG's own
    // 150ms transition smooths the steps, write straight to the vars, no rAF.
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      // Below `lg` the callout crops the avatar to the card's corner; if the
      // box has collapsed there is nothing to aim.
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
      // (the export's viewBox is square) and reserves the box before the
      // face arrives.
      className={cn("pointer-events-none aspect-square select-none", className)}
      dangerouslySetInnerHTML={html ? { __html: html } : undefined}
    />
  );
}
