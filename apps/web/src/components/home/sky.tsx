import type { CSSProperties } from "react";
import { cn } from "@agent-hub/ui";

/* Daytime birds (top in %, delay/duration in s, scale). Matching durations
   and nearby delays create loose formations without synchronizing every
   wing beat. Negative delays populate the sky immediately on first paint. */
const FLYING_BIRDS: Array<[number, number, number, number]> = [
  [10, -4.2, 28, 0.96],
  [13, -3.3, 28, 0.72],
  [9, -2.5, 28, 0.6],
  [16, -1.7, 28, 0.48],
  [31, -20.4, 34, 0.82],
  [34, -19.1, 34, 0.62],
  [29, -17.9, 34, 0.52],
  [57, -9.6, 31, 0.9],
  [60, -8.4, 31, 0.66],
  [63, -7.3, 31, 0.5],
];

/* Footer flock — tuned to the glassy card's geometry. Each bird crosses the
   full width, so the upper band (open sky above the card) keeps them in
   plain view while the lower band stays readable in the gutters to the left
   and right of the card (and drifts as a soft silhouette behind its glass in
   between). Larger scales than the hero so they read at footer size. */
const FOOTER_BIRDS: Array<[number, number, number, number]> = [
  [7, -3.0, 30, 1.0],
  [12, -14.5, 30, 0.78],
  [16, -8.2, 32, 0.9],
  [21, -22.0, 32, 0.66],
  [10, -18.5, 34, 0.82],
  [45, -6.4, 33, 0.98],
  [57, -16.8, 31, 0.74],
  [68, -26.2, 35, 0.9],
];

export function FlyingBirds({
  className,
  sparse = false,
  variant = "hero",
}: {
  className?: string;
  sparse?: boolean;
  variant?: "hero" | "footer";
}) {
  const base = variant === "footer" ? FOOTER_BIRDS : FLYING_BIRDS;
  const birds = sparse
    ? base.filter((_, index) => index % 3 !== 2)
    : base;

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className
      )}
      aria-hidden="true"
    >
      {birds.map(([top, delay, duration, scale], i) => (
        <span
          key={i}
          className="home-bird-flight"
          style={
            {
              top: `${top}%`,
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s`,
              "--bird-scale": scale,
              "--bird-flap-delay": `${(i % 3) * -0.18}s`,
            } as CSSProperties
          }
        >
          <span className="home-bird">
            <span className="home-bird-wing home-bird-wing-left" />
            <span className="home-bird-wing home-bird-wing-right" />
          </span>
        </span>
      ))}
    </div>
  );
}

/* Static scene pieces for the marketing home: a field of twinkling stars
   and the falling-star streaks. All server-safe — positions are fixed
   constants so SSR and client markup always match. (The hero clouds are
   painterly PNGs in public/images/home, not drawn here.) */

/* Deterministic star field (top/left in %, size in px, delay in s). */
const HERO_STARS: Array<[number, number, number, number]> = [
  [6, 8, 2, 0.2], [12, 22, 1, 1.4], [8, 37, 2, 2.6], [15, 51, 1, 0.8],
  [5, 64, 2, 1.9], [11, 78, 1, 3.0], [7, 91, 2, 0.5], [22, 5, 1, 2.2],
  [26, 18, 2, 0.9], [20, 33, 1, 1.7], [28, 47, 2, 2.9], [24, 61, 1, 0.4],
  [21, 74, 2, 1.2], [27, 88, 1, 2.4], [36, 12, 2, 0.7], [33, 27, 1, 1.9],
  [39, 42, 2, 3.1], [35, 57, 1, 0.3], [38, 70, 2, 1.5], [34, 84, 1, 2.7],
  [47, 7, 1, 1.1], [44, 21, 2, 2.3], [49, 36, 1, 0.6], [45, 52, 2, 1.8],
  [48, 66, 1, 2.8], [43, 80, 2, 0.1], [46, 94, 1, 1.6],
];

/* Extra stars for the denser hero sky — fills the gaps and reaches lower
   (50–80%) than the base field. Same deterministic-constants rule. */
const HERO_STARS_DENSE: Array<[number, number, number, number]> = [
  [3, 15, 1, 0.6], [9, 45, 1, 2.1], [14, 68, 2, 1.3], [4, 72, 1, 2.8],
  [18, 12, 1, 0.9], [16, 86, 1, 1.6], [25, 40, 1, 2.5], [30, 8, 1, 0.2],
  [23, 95, 2, 1.1], [31, 66, 1, 2.0], [37, 50, 1, 0.5], [41, 18, 1, 1.8],
  [40, 90, 2, 2.6], [44, 74, 1, 0.8], [52, 10, 2, 1.4], [51, 28, 1, 2.9],
  [55, 45, 1, 0.3], [53, 62, 2, 1.9], [57, 82, 1, 2.3], [60, 96, 1, 0.7],
  [63, 20, 1, 1.5], [66, 38, 2, 2.7], [62, 55, 1, 0.4], [68, 71, 1, 1.0],
  [71, 6, 2, 2.2], [74, 47, 1, 1.7], [70, 88, 1, 0.1], [77, 30, 1, 2.4],
];

export function StarField({
  className,
  dense,
}: {
  className?: string;
  dense?: boolean;
}) {
  const stars = dense ? [...HERO_STARS, ...HERO_STARS_DENSE] : HERO_STARS;
  return (
    <div className={cn("pointer-events-none absolute inset-0", className)} aria-hidden="true">
      {stars.map(([top, left, size, delay], i) => (
        <span
          key={i}
          className="home-star"
          style={{
            top: `${top}%`,
            left: `${left}%`,
            width: size,
            height: size,
            animationDelay: `${delay}s`,
          }}
        />
      ))}
    </div>
  );
}

/* Falling stars (top/left in %, delay in s, duration in s). */
const FALLING_STARS: Array<[number, number, number, number]> = [
  [8, 82, 0, 7],
  [4, 55, 2.4, 8],
  [16, 96, 4.1, 6.5],
  [2, 30, 5.6, 9],
  [22, 68, 7.8, 7.5],
  [12, 42, 9.3, 8.5],
];

export function FallingStars({ className }: { className?: string }) {
  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden="true">
      {FALLING_STARS.map(([top, left, delay, duration], i) => (
        <span
          key={i}
          className="home-falling-star"
          style={{
            top: `${top}%`,
            left: `${left}%`,
            animationDelay: `${delay}s`,
            animationDuration: `${duration}s`,
          }}
        />
      ))}
    </div>
  );
}
