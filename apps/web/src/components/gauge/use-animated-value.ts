"use client"

import { useEffect, useRef, useState } from "react"

import {
  easingFunction,
  resolveTransition,
  springPhysics,
  stepSpring,
  type GaugeTransition,
  type SpringState,
} from "./transition"

/** Folds a change into [-span/2, span/2), the short way round a circle. */
const shortestDelta = (delta: number, span: number) => {
  const s = Math.max(span, 1e-9)
  return ((((delta + s / 2) % s) + s) % s) - s / 2
}

/**
 * Follows `target` with the given transition and returns the value to draw
 * this frame. With no transition it returns `target` as is and renders
 * nothing extra. Honours `prefers-reduced-motion` by snapping.
 *
 * `span` is the size of the domain and sets the rest threshold. `initial` is
 * where the value starts on mount, for a sweep-in from the minimum. `wrap`
 * treats the domain as circular: every change is followed the shortest way
 * round, so a heading crossing north never swings the long way back. The
 * returned value may then sit outside the domain mid-flight; map it back
 * with a modulo.
 */
export const useAnimatedValue = (
  target: number,
  transition: GaugeTransition | boolean | undefined,
  span: number,
  initial?: number,
  wrap?: boolean
) => {
  const enabled = Boolean(transition)
  const [display, setDisplay] = useState(initial ?? target)
  const spring = useRef<SpringState>({ value: initial ?? target, velocity: 0 })

  /* With `wrap` the target is folded into a continuous series so the spring
     crosses the seam instead of doubling back. Each change is folded in as
     it renders — the sanctioned way to adjust state to a new prop — and the
     series snaps back to the canonical target at rest, so turning forever
     never drifts far. */
  const start = initial ?? target
  const [series, setSeries] = useState(() => ({
    raw: target,
    goal: wrap ? start + shortestDelta(target - start, span) : target,
  }))
  if (wrap && (target !== series.raw || (!enabled && target !== series.goal))) {
    setSeries(
      enabled
        ? {
            raw: target,
            goal: series.goal + shortestDelta(target - series.raw, span),
          }
        : /* Without a transition the series just shadows the target, so
             re-enabling one starts from what is on screen. */
          { raw: target, goal: target }
    )
  }
  const goal = wrap ? series.goal : target

  // The config is read through a ref so an inline object or easing function
  // does not restart the animation every render; only its content matters.
  const transitionRef = useRef(transition)
  useEffect(() => {
    transitionRef.current = transition
  })
  const configKey = JSON.stringify(transition)

  // While disabled, keep the spring state in step so re-enabling animates
  // from what is on screen rather than from a stale value.
  useEffect(() => {
    if (!enabled) spring.current = { value: target, velocity: 0 }
  }, [enabled, target])

  useEffect(() => {
    const config = resolveTransition(transitionRef.current)
    if (!config) return
    const precision = Math.max(span, 1e-6) * 1e-4
    const snap = prefersReducedMotion()
    /* Where the value comes to rest: the canonical target, so a wrapped
       series that has gone round a few times folds back into the domain. */
    const restAt = target

    let frame = 0
    let last = performance.now()
    const from = spring.current.value
    const start = last

    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      let done: boolean

      if (snap) {
        done = true
      } else if (config.type === "spring") {
        const physics = springPhysics(config)
        const next = stepSpring(spring.current, goal, physics, dt, precision)
        spring.current = next.state
        done = next.done
      } else {
        const duration = Math.max(config.duration ?? 0.5, 1e-3)
        const progress = Math.min((now - start) / 1000 / duration, 1)
        const eased = easingFunction(config.ease)(progress)
        const value = from + (goal - from) * eased
        spring.current = { value, velocity: 0 }
        done = progress >= 1
      }

      if (done) {
        spring.current = { value: restAt, velocity: 0 }
        if (wrap) {
          setSeries((s) =>
            s.raw === restAt && s.goal === restAt
              ? s
              : { raw: restAt, goal: restAt }
          )
        }
      }
      setDisplay(spring.current.value)
      if (!done) frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [goal, target, configKey, span, wrap])

  return enabled ? display : target
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches
