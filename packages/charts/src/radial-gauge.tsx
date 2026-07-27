import type { ReactNode } from "react";
import { cn } from "./cn";
import { gaugeRingGeometry, ringDash } from "./gauge";

/**
 * Concentric ring gauge: one ring per measured window, outermost first, with
 * free-form content in the middle.
 *
 * Hand-built SVG, no charting dependency, and server-component safe — no hooks,
 * no measurement, no animation. All the arithmetic lives in `gauge.ts`; this
 * file only turns it into elements.
 */
export interface RadialGaugeRing {
  /** How full, 0..1. Values past 1 render full; a cap that is exceeded is still full. */
  fraction: number;
  /** Tailwind stroke class for the filled arc (e.g. "stroke-emerald-500"). */
  toneClass: string;
  /** Accessible name for this ring, e.g. "This week: 62% used". */
  label: string;
}

export interface RadialGaugeProps {
  rings: readonly RadialGaugeRing[];
  /** Box size in px; the gauge is always square. */
  size?: number;
  strokeWidth?: number;
  /** Space between rings, px. */
  gap?: number;
  /** Rendered centred inside the rings — typically the leading percentage. */
  children?: ReactNode;
  className?: string;
}

export function RadialGauge({
  rings,
  size = 96,
  strokeWidth = 8,
  gap = 4,
  children,
  className,
}: RadialGaugeProps) {
  const geometry = gaugeRingGeometry(rings.length, { size, strokeWidth, gap });
  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={rings.map((r) => r.label).join(" · ")}
        // Rings start at twelve o'clock and fill clockwise, which is how a
        // "how much is left" dial is read.
        className="-rotate-90"
      >
        {rings.map((ring, index) => {
          const { radius, center } = geometry[index];
          const { circumference, dashOffset } = ringDash(ring.fraction, radius);
          return (
            <g key={ring.label}>
              <circle
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                strokeWidth={strokeWidth}
                className="stroke-muted"
              />
              <circle
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                className={ring.toneClass}
              />
            </g>
          );
        })}
      </svg>
      {children ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {children}
        </div>
      ) : null}
    </div>
  );
}
