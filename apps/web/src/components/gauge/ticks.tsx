"use client"

import { cn } from "@/lib/utils"
import { cutValues, polar, stepValues } from "./math"
import type { GaugeContextValue } from "./context"
import {
  fontClass,
  weightClass,
  type FontFamily,
  type FontWeight,
  type StrokeCap,
} from "./utils"

import { useGauge } from "./context"

/**
 * Evenly spaced domain values for ticks. On a closed ring the last step lands
 * on the first, so it is dropped rather than drawn twice.
 */
const tickValues = (
  { min, max, startAngle, endAngle }: GaugeContextValue,
  count: number
) => {
  const values = stepValues(min, max, count)
  if (endAngle - startAngle >= 360) values.pop()
  return values
}

type RadialLineProps = {
  /** Length of each line along the radius. */
  length?: number
  width?: number
  color?: string
  opacity?: number
  cap?: StrokeCap
  /** Radial offset of the line's midpoint from the reference radius. */
  offset?: number
}

const RadialLines = ({
  angles,
  length = 12,
  width = 2,
  color = "currentColor",
  opacity = 1,
  cap = "round",
  offset = 0,
}: RadialLineProps & { angles: number[] }) => {
  const { radius } = useGauge()
  const inner = radius + offset - length / 2
  const outer = radius + offset + length / 2

  return (
    <g
      stroke={color}
      strokeOpacity={opacity}
      strokeWidth={width}
      strokeLinecap={cap}
    >
      {angles.map((angle, i) => {
        const a = polar(inner, angle)
        const b = polar(outer, angle)
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      })}
    </g>
  )
}

export type GaugeTicksProps = RadialLineProps & {
  /** Number of intervals across the domain; renders `count + 1` ticks. */
  count?: number
}

/** Evenly spaced tick marks across the whole arc. */
export const GaugeTicks = ({ count = 10, ...props }: GaugeTicksProps) => {
  const gauge = useGauge()
  const angles = tickValues(gauge, count).map(gauge.angleOf)
  return <RadialLines angles={angles} {...props} />
}

export type GaugeMarksProps = RadialLineProps & {
  /** Domain values to mark, for example the cutoffs between zones. */
  values?: number[]
  /**
   * Cut the domain into this many equal segments instead: the marks fall
   * between the segments, none at the two ends. On a closed ring the seam is
   * cut too, since the last segment meets the first there. Drawn in the
   * surface's colour over a band, they slice it the way a water ring is cut
   * into glasses.
   */
  count?: number
}

/** Radial marks at arbitrary domain values, or at equal cuts of the domain. */
export const GaugeMarks = ({ values, count, ...props }: GaugeMarksProps) => {
  const { min, max, startAngle, endAngle, angleOf } = useGauge()
  const marks =
    values ??
    (count && count > 1
      ? [
          ...(endAngle - startAngle >= 360 ? [min] : []),
          ...cutValues(min, max, count),
        ]
      : [])
  return <RadialLines angles={marks.map(angleOf)} {...props} />
}

export type GaugeTickLabelsProps = {
  count?: number
  /** Radial offset of the label centre from the reference radius. */
  offset?: number
  fontSize?: number
  color?: string
  font?: FontFamily
  weight?: FontWeight
  decimals?: number
  format?: (value: number) => string
}

/** Numeric labels at evenly spaced values across the arc. */
export const GaugeTickLabels = ({
  count = 10,
  offset = -48,
  fontSize = 16,
  color = "currentColor",
  font = "sans",
  weight = "medium",
  decimals = 0,
  format,
}: GaugeTickLabelsProps) => {
  const gauge = useGauge()
  const { radius, angleOf } = gauge
  const values = tickValues(gauge, count)

  return (
    <g
      fill={color}
      fontSize={fontSize}
      textAnchor="middle"
      dominantBaseline="central"
      className={cn(fontClass[font], weightClass[weight], "tabular-nums")}
    >
      {values.map((value, i) => {
        const p = polar(radius + offset, angleOf(value))
        return (
          <text key={i} x={p.x} y={p.y}>
            {format ? format(value) : value.toFixed(decimals)}
          </text>
        )
      })}
    </g>
  )
}
