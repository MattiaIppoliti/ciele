"use client"

import { createContext, useContext } from "react"

import { clamp, valueToAngle } from "./math"
import type { GaugeTransition } from "./transition"
import { useAnimatedValue } from "./use-animated-value"

export type GaugeContextValue = {
  /** Value being drawn this frame, clamped to the domain. Animated when the
      gauge has a transition. */
  value: number
  /** Value the gauge is heading for; equals `value` once settled. */
  target: number
  min: number
  max: number
  startAngle: number
  endAngle: number
  /** Radius of the gauge's reference circle in SVG units. */
  radius: number
  /** Maps a domain value onto a gauge angle. */
  angleOf: (value: number) => number
}

export const GaugeContext = createContext<GaugeContextValue | null>(null)

export const useGauge = () => {
  const ctx = useContext(GaugeContext)
  if (!ctx) {
    throw new Error("Gauge primitives must be rendered inside <Gauge>.")
  }
  return ctx
}

/** The domain, geometry and animation every gauge root takes. */
export type GaugeDomainProps = {
  value: number
  min?: number
  max?: number
  /** Gauge degrees, clockwise from six o'clock. */
  startAngle?: number
  endAngle?: number
  /** Reference radius in SVG units. Every child positions itself against this. */
  radius?: number
  /**
   * Animate towards new values. `true` uses a gentle spring; pass a
   * `GaugeTransition` to tune it or switch to a timed tween. Omit for
   * instant updates.
   */
  transition?: GaugeTransition | boolean
  /** Where the value starts on mount when animating, for a sweep-in effect. */
  initialValue?: number
  /**
   * Treat the domain as circular, as a compass rose or clock face is: the
   * value is mapped into the domain modulo its span and animates the
   * shortest way round, so a heading crossing north never swings the long
   * way back. Meant for closed rings, where `min` and `max` read the same.
   */
  wrap?: boolean
  /**
   * Turn the whole scale this many degrees clockwise, the way a compass card
   * turns under a fixed lubber line. Animated by `transition`, always the
   * shortest way round.
   */
  rotate?: number
}

/**
 * Resolves the domain and follows the value, returning the context a gauge
 * root publishes to its children. Shared by `Gauge` and `GaugeInset` so a
 * gauge nested inside another animates and maps values exactly like a
 * top-level one, and so the defaults live in one place.
 */
export const useGaugeContextValue = ({
  value,
  min = 0,
  max = 100,
  startAngle = 40,
  endAngle = 320,
  radius = 200,
  transition,
  initialValue,
  wrap = false,
  rotate = 0,
}: GaugeDomainProps): GaugeContextValue => {
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  const span = hi - lo
  /* A wrapped domain folds any value back inside itself instead of clamping,
     so 370° on a compass reads as 10°. */
  const fold = (v: number) =>
    span === 0 ? lo : lo + ((((v - lo) % span) + span) % span)
  const settle = wrap ? fold : (v: number) => clamp(v, lo, hi)

  const target = settle(value)
  const shown = useAnimatedValue(
    target,
    transition,
    span,
    initialValue === undefined ? undefined : settle(initialValue),
    wrap
  )
  /* The rotation is a bearing, so it always takes the short way round. */
  const turned = useAnimatedValue(rotate, transition, 360, undefined, true)
  const a0 = startAngle + turned
  const a1 = endAngle + turned

  return {
    /* Folded when wrapped, otherwise as the spring left it, overshoot and
       all — a bounce past the end is part of the motion. */
    value: wrap ? fold(shown) : shown,
    target,
    min,
    max,
    startAngle: a0,
    endAngle: a1,
    radius,
    angleOf: (v) => valueToAngle(v, min, max, a0, a1),
  }
}
