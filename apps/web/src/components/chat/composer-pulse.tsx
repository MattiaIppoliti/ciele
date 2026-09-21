"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";

/**
 * Dia-style glow pulse that races along the composer's border.
 *
 * The overlay measures its own pixel size and uses it verbatim as the SVG
 * viewBox (1:1, no `preserveAspectRatio` distortion), so the glow keeps a
 * constant pixel thickness whether the composer is the narrow right-bar
 * preview or a wide large-mode window. The border path and glow radius are
 * derived from the measured dimensions rather than a fixed 604x108 box.
 *
 * **The corner radius is measured too, off the composer itself.** It used to be
 * three hand-written constants, and all three disagreed with each other and
 * with the composer: the overlay clipped at 14, the mask punched its hole at
 * 12, the path turned at 14, and `rounded-2xl` on this theme is 14.4. A hole
 * squarer than the box it is meant to cut leaves the glow painting *over* the
 * composer's own corner, which is what "the line does not follow the border"
 * looked like. One measured number now feeds all three, so a change to the
 * theme's radius scale cannot put them out of step again.
 *
 * `focus` fires the two-dot race (bottom-center → top-center on each half);
 * `loading` shows a single dot circling the whole border clockwise, looping
 * until the response finishes streaming. The CSS classes (globals.css) drive
 * the `offset-distance` animation; the `offset-path` is supplied inline here
 * from the live dimensions.
 */
export function ComposerPulse({
  color,
  focus,
  loading,
}: {
  color: string;
  focus: boolean;
  loading: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0, radius: FALLBACK_RADIUS });
  const gradientId = useId();
  const maskId = useId();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({
        w: Math.round(r.width),
        h: Math.round(r.height),
        radius: composerRadius(el),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { w, h, radius } = size;
  const paths = w > 0 && h > 0 ? borderPaths(w, h, radius) : null;

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute -inset-[2px] z-10 overflow-hidden"
      // The overlay sits INSET px outside the composer on every side, so its
      // own clip has to be that much rounder than the composer's corner or it
      // would cut the ring it exists to show.
      style={{ borderRadius: radius + INSET }}
    >
      {paths && (
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${w} ${h}`}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <radialGradient id={gradientId}>
              <stop offset="1%" stopColor={color} stopOpacity="1" />
              <stop offset="3%" stopColor={color} stopOpacity="0.8" />
              <stop offset="20%" stopColor={color} stopOpacity="0.4" />
              <stop offset="50%" stopColor={color} stopOpacity="0.15" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </radialGradient>
            <mask id={maskId}>
              <rect width={w} height={h} fill="white" />
              {/* The composer's own box, punched out: what stays white is
                  the ring between its border and the overlay's edge. Same
                  radius as the composer, or the corners leak. */}
              <rect
                x={INSET}
                y={INSET}
                width={w - INSET * 2}
                height={h - INSET * 2}
                rx={radius}
                ry={radius}
                fill="black"
              />
            </mask>
          </defs>
          <g mask={`url(#${maskId})`}>
            {loading ? (
              <circle
                r={GLOW_RADIUS}
                fill={`url(#${gradientId})`}
                filter="blur(6px)"
                className="composer-pulse-loading"
                style={{ offsetPath: `path("${paths.loop}")` }}
              />
            ) : (
              focus && (
                <>
                  <circle
                    r={GLOW_RADIUS}
                    fill={`url(#${gradientId})`}
                    filter="blur(6px)"
                    className="composer-pulse-left"
                    style={{ offsetPath: `path("${paths.left}")` }}
                  />
                  <circle
                    r={GLOW_RADIUS}
                    fill={`url(#${gradientId})`}
                    filter="blur(6px)"
                    className="composer-pulse-right"
                    style={{ offsetPath: `path("${paths.right}")` }}
                  />
                </>
              )
            )}
          </g>
        </svg>
      )}
    </div>
  );
}

/** Fixed pixel radius so the glow reads the same on every composer size. */
const GLOW_RADIUS = 44;

/**
 * How far the overlay extends past the composer on each side. Matches the
 * `-inset-[2px]` above; the ring the glow shows through is exactly this wide.
 */
const INSET = 2;

/**
 * Used only until the first measurement lands, and when the composer cannot be
 * found. `rounded-2xl` on this theme, which is what `PromptInput` wears.
 */
const FALLBACK_RADIUS = 14.4;

/**
 * The composer's own corner radius, read from the element rather than repeated
 * here. The overlay is a sibling of `PromptInput`'s form inside the composer's
 * positioning wrapper, which is the one structural fact this depends on; when
 * it does not hold, the fallback keeps the glow drawn rather than dropped.
 */
function composerRadius(overlay: HTMLElement): number {
  const form = overlay.parentElement?.querySelector("form");
  if (!form) return FALLBACK_RADIUS;
  const measured = Number.parseFloat(
    getComputedStyle(form).borderTopLeftRadius
  );
  return Number.isFinite(measured) && measured > 0 ? measured : FALLBACK_RADIUS;
}

/**
 * Rounded-rectangle border paths for a `w`x`h` overlay: the composer's own
 * border, which sits {@link INSET} px inside the overlay on every side, traced
 * at the composer's own corner radius.
 */
function borderPaths(w: number, h: number, cr: number) {
  const i = INSET;
  const cx = w / 2;
  const top = i;
  const bot = h - i;
  const left = i;
  const right = w - i;
  return {
    // bottom-center → left half → top-center
    left: `M ${cx} ${bot} L ${left + cr} ${bot} A ${cr} ${cr} 0 0 1 ${left} ${bot - cr} L ${left} ${top + cr} A ${cr} ${cr} 0 0 1 ${left + cr} ${top} L ${cx} ${top}`,
    // bottom-center → right half → top-center
    right: `M ${cx} ${bot} L ${right - cr} ${bot} A ${cr} ${cr} 0 0 0 ${right} ${bot - cr} L ${right} ${top + cr} A ${cr} ${cr} 0 0 0 ${right - cr} ${top} L ${cx} ${top}`,
    // full clockwise loop from top-center
    loop: `M ${cx} ${top} L ${right - cr} ${top} A ${cr} ${cr} 0 0 1 ${right} ${top + cr} L ${right} ${bot - cr} A ${cr} ${cr} 0 0 1 ${right - cr} ${bot} L ${left + cr} ${bot} A ${cr} ${cr} 0 0 1 ${left} ${bot - cr} L ${left} ${top + cr} A ${cr} ${cr} 0 0 1 ${left + cr} ${top} Z`,
  };
}
