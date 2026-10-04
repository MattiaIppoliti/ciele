"use client"

import type { SVGProps } from "react"

import { GaugeContext, useGaugeContextValue } from "./context"
import type { GaugeDomainProps } from "./context"

export type GaugeInsetProps = Omit<SVGProps<SVGGElement>, "transform"> &
  GaugeDomainProps & {
    /** Centre of the inset in the host gauge's SVG units. Positive y is down. */
    x?: number
    y?: number
    /** Size relative to the host gauge: 0.3 draws it at a third of the size. */
    scale?: number
  }

/**
 * A whole gauge drawn inside another one: a fuel dial under a speedometer, a
 * second ring inside the first. It takes its own value and domain and sets up
 * the same context `Gauge` does, so every primitive works inside it unchanged.
 *
 * It draws in the host's coordinate system rather than its own viewport, so it
 * needs no `padding` or `fit`; `x`, `y` and `scale` place it, and everything
 * inside — strokes, ticks, text — shrinks with it. Its reference radius stays
 * the host's by default, which makes `scale` the only size to reason about.
 */
export const GaugeInset = ({
  value,
  min,
  max,
  startAngle,
  endAngle,
  radius,
  transition,
  initialValue,
  x = 0,
  y = 0,
  scale = 1,
  children,
  ...props
}: GaugeInsetProps) => {
  const gauge = useGaugeContextValue({
    value,
    min,
    max,
    startAngle,
    endAngle,
    radius,
    transition,
    initialValue,
  })

  return (
    <GaugeContext.Provider value={gauge}>
      <g transform={`translate(${x} ${y}) scale(${scale})`} {...props}>
        {children}
      </g>
    </GaugeContext.Provider>
  )
}
