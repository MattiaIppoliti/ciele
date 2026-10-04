// Gauge UI: https://gauge-ui.dev/r/gauge.json. Upstream MIT notice: ./LICENSE.
export { Gauge, type GaugeFit, type GaugeProps } from "./gauge"
export { GaugeInset, type GaugeInsetProps } from "./inset"
export {
  useGauge,
  type GaugeContextValue,
  type GaugeDomainProps,
} from "./context"
export {
  GaugeTrack,
  GaugeArc,
  GaugeStack,
  GaugeZones,
  type GaugeArcProps,
  type GaugeStackPart,
  type GaugeStackProps,
  type GaugeZonesProps,
} from "./arcs"
export { GaugeControl, type GaugeControlProps } from "./control"
export {
  GaugeTicks,
  GaugeMarks,
  GaugeTickLabels,
  type GaugeTicksProps,
  type GaugeMarksProps,
  type GaugeTickLabelsProps,
} from "./ticks"
export {
  GaugeText,
  GaugeValue,
  type GaugeTextProps,
  type GaugeValueProps,
} from "./text"
export { GaugeDot, type GaugeDotProps } from "./dot"
export {
  GaugeNeedle,
  GaugeHub,
  type GaugeNeedleProps,
  type GaugeHubProps,
} from "./needle"
export {
  angleToValue,
  arcBox,
  arcPath,
  clamp,
  cutValues,
  degreesToRadians,
  polar,
  stepValues,
  valueToAngle,
  valueToTurnedAngle,
} from "./math"
export {
  clockLabel,
  clockTime,
  compassLabel,
  durationLabel,
  fadeColor,
  fontClass,
  weightClass,
  zoneColor,
  zoneCutoffs,
  type FontFamily,
  type FontWeight,
  type NeedleStyle,
  type StrokeCap,
  type TextAnchor,
  type Zone,
} from "./utils"
export {
  DEFAULT_TRANSITION,
  cubicBezier,
  easingFunction,
  resolveTransition,
  springPhysics,
  stepSpring,
  type GaugeEasing,
  type GaugeSpringTransition,
  type GaugeTransition,
  type GaugeTweenTransition,
} from "./transition"
export { useAnimatedValue } from "./use-animated-value"
