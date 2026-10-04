"use client"

import {
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react"

import { cn } from "@/lib/utils"
import { angleToValue, clamp } from "./math"

/** How far out from the centre a press starts counting as the ring, as a
    share of the half width. Inside it is the face, left for `onPress`. */
const FACE = 0.55

/** Too near the centre for the angle under the pointer to mean anything. */
const HUB = 0.08

/** The gauge angle under a point, measured round the element's centre. */
const angleAt = (el: HTMLElement, x: number, y: number) => {
  const box = el.getBoundingClientRect()
  const dx = x - (box.left + box.width / 2)
  const dy = y - (box.top + box.height / 2)
  const theta = (Math.atan2(dy, dx) * 180) / Math.PI
  return {
    /* Gauge degrees start at six o'clock, a quarter turn behind the maths. */
    angle: (((theta - 90) % 360) + 360) % 360,
    /** How far out from the centre, as a share of the half width. */
    reach: Math.hypot(dx, dy) / (box.width / 2),
  }
}

export type GaugeControlProps = {
  value: number
  onChange: (value: number) => void
  /** A press on the middle of the face, or Enter, for a dial that is also a
      switch. Left out, the middle does nothing. */
  onPress?: () => void
  min?: number
  max?: number
  /** Granularity a drag lands on, and the size of an arrow-key step. */
  step?: number
  /** Gauge degrees, matching the gauge drawn inside. */
  startAngle?: number
  endAngle?: number
  /** Read to screen readers; every slider needs one. */
  label: string
  /** The value as it would be spoken: "21.5 °C" rather than 21.5. */
  valueText?: string
  /** The face turns like a knob: a drag anywhere on it moves the value by as
      far as the pointer goes round, rather than jumping to where it is. */
  knob?: boolean
  disabled?: boolean
  className?: string
  children: ReactNode
}

/**
 * Makes the square gauge inside it a slider: drag round the ring to set it,
 * or use the arrow keys, Page Up and Down, Home and End. A drag past either
 * end of the sweep holds there rather than jumping to the other. A press in
 * the middle of the face, or Enter, is left for `onPress`, which a dimmer
 * uses to switch on and off, or, with `knob`, turns the face from where it
 * is. The domain and angles default to `Gauge`'s own.
 */
export const GaugeControl = ({
  value,
  onChange,
  onPress,
  min = 0,
  max = 100,
  step = 1,
  startAngle = 40,
  endAngle = 320,
  label,
  valueText,
  knob = false,
  disabled = false,
  className,
  children,
}: GaugeControlProps) => {
  /* Whether the press that is down started in the middle of the face. */
  const pressed = useRef(false)
  /* A knob turn under way: the angle last seen, and the value it has got to
     before rounding to a step. */
  const turn = useRef<{ angle: number; value: number } | null>(null)

  const set = (next: number) =>
    onChange(clamp(Number(next.toFixed(2)), min, max))

  const valueUnder = (el: HTMLElement, x: number, y: number) => {
    const raw = angleToValue(
      angleAt(el, x, y).angle,
      min,
      max,
      startAngle,
      endAngle
    )
    return Math.round(raw / step) * step
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    const { angle, reach } = angleAt(e.currentTarget, e.clientX, e.clientY)
    if (reach < FACE && knob) {
      e.currentTarget.setPointerCapture(e.pointerId)
      turn.current = { angle, value }
      return
    }
    if (reach < FACE) {
      pressed.current = true
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    set(valueUnder(e.currentTarget, e.clientX, e.clientY))
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    if (turn.current) {
      const { angle, reach } = angleAt(e.currentTarget, e.clientX, e.clientY)
      if (reach < HUB) return
      /* The shortest way round from the last angle, so crossing six o'clock
         is a small step and not a whole turn back. */
      const by = ((angle - turn.current.angle + 540) % 360) - 180
      const value = clamp(
        turn.current.value + (by / (endAngle - startAngle)) * (max - min),
        min,
        max
      )
      turn.current = { angle, value }
      set(Math.round(value / step) * step)
      return
    }
    set(valueUnder(e.currentTarget, e.clientX, e.clientY))
  }

  const onPointerUp = () => {
    if (pressed.current) onPress?.()
    pressed.current = false
    turn.current = null
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const big = (max - min) / 10
    const moves: Record<string, number> = {
      ArrowUp: value + step,
      ArrowRight: value + step,
      ArrowDown: value - step,
      ArrowLeft: value - step,
      PageUp: value + big,
      PageDown: value - big,
      Home: min,
      End: max,
    }
    if (e.key in moves) {
      e.preventDefault()
      set(moves[e.key])
    } else if ((e.key === "Enter" || e.key === " ") && onPress) {
      e.preventDefault()
      onPress()
    }
  }

  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      aria-disabled={disabled}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        pressed.current = false
        turn.current = null
      }}
      onKeyDown={onKeyDown}
      className={cn(
        "aspect-square touch-none rounded-full outline-none select-none focus-visible:ring-2 focus-visible:ring-ring",
        disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing",
        className
      )}
    >
      {children}
    </div>
  )
}
