import { cn } from "./cn";

/**
 * Viewport-bottom progressive blur: content softens as it exits the bottom
 * edge of the screen, the way a lens loses focus at its rim.
 *
 * There is no native "gradient blur", so the ramp is faked with a stack of
 * backdrop-filter layers. Each layer blurs a little more than the one above
 * and is masked to a band one segment lower, and adjacent bands overlap by a
 * full segment so no seam shows between strengths. Six layers ≈ smooth to the
 * eye; more just costs compositing time.
 *
 * The wrapper is `position: fixed`, so it must not sit under a transformed /
 * filtered ancestor (that would re-anchor it to the ancestor, not the
 * viewport). Purely decorative: pointer-events pass through and it is hidden
 * from the accessibility tree.
 */
const LAYER_COUNT = 6;

export function ProgressiveBlur({
  className,
  maxBlur = 16,
  tint,
}: {
  className?: string;
  /** Blur radius (px) of the strongest, bottom-most band. */
  maxBlur?: number;
  /**
   * Optional CSS color the bottom edge fades toward (pass the surface's own
   * background token, e.g. `var(--background)`). Omitted = blur only.
   */
  tint?: string;
}) {
  const segment = 100 / (LAYER_COUNT + 1);
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-10 h-32",
        className,
      )}
    >
      {Array.from({ length: LAYER_COUNT }, (_, i) => {
        // Halve the blur per step up the stack: …2, 4, 8, 16 for maxBlur 16.
        const blur = maxBlur / 2 ** (LAYER_COUNT - 1 - i);
        const stop = (n: number) => `${Math.min(n * segment, 100)}%`;
        // The bottom-most band must hold full strength through the edge: a
        // clamped trailing stop would fade it out at exactly 100%.
        const tail =
          (i + 2) * segment >= 100 ? "" : `, transparent ${stop(i + 3)}`;
        const mask = `linear-gradient(to bottom, transparent ${stop(i)}, black ${stop(i + 1)}, black ${stop(i + 2)}${tail})`;
        return (
          <div
            key={i}
            className="absolute inset-0"
            style={{
              backdropFilter: `blur(${blur}px)`,
              WebkitBackdropFilter: `blur(${blur}px)`,
              maskImage: mask,
              WebkitMaskImage: mask,
            }}
          />
        );
      })}
      {tint && (
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to bottom, transparent, color-mix(in oklab, ${tint} 85%, transparent))`,
          }}
        />
      )}
    </div>
  );
}
