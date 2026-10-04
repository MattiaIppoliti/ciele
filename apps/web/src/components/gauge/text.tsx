"use client"

import type { ReactNode } from "react"

import { cn } from "@/lib/utils"
import {
  fontClass,
  weightClass,
  type FontFamily,
  type FontWeight,
  type TextAnchor,
} from "./utils"

import { useGauge } from "./context"

export type GaugeTextProps = {
  /** Position relative to the gauge centre in SVG units. Positive y is down. */
  x?: number
  y?: number
  fontSize?: number
  color?: string
  font?: FontFamily
  weight?: FontWeight
  anchor?: TextAnchor
  className?: string
  children: ReactNode
}

/** A free-standing label anywhere on the gauge. */
export const GaugeText = ({
  x = 0,
  y = 0,
  fontSize = 24,
  color = "currentColor",
  font = "sans",
  weight = "medium",
  anchor = "middle",
  className,
  children,
}: GaugeTextProps) => (
  <text
    x={x}
    y={y}
    fill={color}
    fontSize={fontSize}
    textAnchor={anchor}
    dominantBaseline="central"
    className={cn(fontClass[font], weightClass[weight], className)}
  >
    {children}
  </text>
)

export type GaugeValueProps = Omit<GaugeTextProps, "children"> & {
  decimals?: number
  format?: (value: number) => string
}

/** The current value as text. */
export const GaugeValue = ({
  decimals = 0,
  format,
  className,
  fontSize = 96,
  weight = "semibold",
  ...props
}: GaugeValueProps) => {
  const { value } = useGauge()
  return (
    <GaugeText
      fontSize={fontSize}
      weight={weight}
      className={cn("tabular-nums", className)}
      {...props}
    >
      {format ? format(value) : value.toFixed(decimals)}
    </GaugeText>
  )
}
