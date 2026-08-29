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
  const [size, setSize] = useState({ w: 0, h: 0 });
  const gradientId = useId();
  const maskId = useId();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { w, h } = size;
  const paths = w > 0 && h > 0 ? borderPaths(w, h) : null;

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute -inset-[2px] z-10 overflow-hidden rounded-[14px]"
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
              <rect
                x={2}
                y={2}
                width={w - 4}
                height={h - 4}
                rx={12}
                ry={12}
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
 * Rounded-rectangle border paths for a `w`x`h` overlay, inset 2px (the border
 * sits 2px in because the overlay extends 2px past the composer on each side),
 * corner radius 14 (composer's 12px + the 2px inset).
 */
function borderPaths(w: number, h: number) {
  const i = 2;
  const cr = 14;
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
