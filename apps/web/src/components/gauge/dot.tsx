"use client"

import { polar, valueToTurnedAngle } from "./math"

import { useGauge } from "./context"

export type GaugeDotProps = {
  /** Radius of the dot itself, in SVG units. */
  radius?: number
  color?: string
  opacity?: number
  /** Radial offset of the dot's centre from the reference radius. */
  offset?: number
  /**
   * Sweeps of the arc the dot makes across the domain, as `GaugeNeedle.turns`:
   * two sends it round twice while the value crosses the domain once.
   */
  turns?: number
  /**
   * Width of a ring drawn behind the dot in `haloColor`, so it stands off
   * whatever band it rides. 0 leaves the dot bare.
   */
  halo?: number
  /** Colour of the halo: the surface under the gauge, usually. */
  haloColor?: string
}

/**
 * A disc riding the arc at the current value: the head of a progress ring, a
 * body on its orbit, the handle on a dial. `GaugeMarks` stands at fixed values
 * and points along the radius; this follows the value the way a needle does,
 * and is round at any size a stroke cap could not reach.
 */
export const GaugeDot = ({
  radius = 10,
  color = "currentColor",
  opacity = 1,
  offset = 0,
  turns = 1,
  halo = 0,
  haloColor = "var(--background)",
}: GaugeDotProps) => {
  const gauge = useGauge()
  const angle = valueToTurnedAngle(
    gauge.value,
    gauge.min,
    gauge.max,
    gauge.startAngle,
    gauge.endAngle,
    turns
  )
  const { x, y } = polar(gauge.radius + offset, angle)

  return (
    <>
      {halo > 0 && (
        <circle
          cx={x}
          cy={y}
          r={radius + halo}
          fill={haloColor}
          fillOpacity={opacity}
        />
      )}
      <circle cx={x} cy={y} r={radius} fill={color} fillOpacity={opacity} />
    </>
  )
}
