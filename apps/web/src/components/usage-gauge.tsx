"use client";

import {
  Gauge,
  GaugeArc,
  GaugeInset,
  GaugeText,
  GaugeTicks,
  GaugeTrack,
} from "@/components/gauge";
import { SPRING_PANEL } from "@/lib/ease";

export interface UsageGaugeRing {
  /** Null means uncapped or unavailable, rather than zero usage. */
  fraction: number | null;
  label: string;
}

/** One ink in either theme; exact values and limit status stay in the labels. */
export function UsageGauge({
  rings,
  valueLabel,
  size = 96,
  variant = "ring",
}: {
  rings: readonly UsageGaugeRing[];
  valueLabel: string;
  size?: number;
  variant?: "ring" | "dial";
}) {
  const startAngle = variant === "dial" ? 45 : 180;
  const endAngle = variant === "dial" ? 315 : 540;

  return (
    <div
      role="img"
      aria-label={`${valueLabel}. ${rings.map((ring) => ring.label).join(". ")}`}
      className="shrink-0 text-foreground"
      style={{ width: size, height: size }}
    >
      <Gauge
        value={0}
        radius={200}
        padding={24}
        startAngle={startAngle}
        endAngle={endAngle}
        aria-hidden="true"
      >
        {rings.map((ring, index) => (
          <GaugeInset
            key={index}
            value={ring.fraction === null ? 0 : ring.fraction * 100}
            radius={200 - index * 40}
            startAngle={startAngle}
            endAngle={endAngle}
            transition={SPRING_PANEL}
          >
            <GaugeTrack width={24} opacity={0.1} />
            {ring.fraction !== null && (
              <GaugeArc width={24} opacity={index === 0 ? 1 : 0.5} />
            )}
            {variant === "dial" && (
              <GaugeTicks count={10} offset={-26} length={8} width={2} opacity={0.3} />
            )}
          </GaugeInset>
        ))}
        {/* Keep the actual label: a capped arc must not turn 125% into 100%. */}
        <GaugeText fontSize={rings.length > 1 ? 82 : 96} weight="semibold" className="tabular-nums">
          {valueLabel}
        </GaugeText>
      </Gauge>
    </div>
  );
}
