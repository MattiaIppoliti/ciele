# Timing

Everything here is **frames**. Seconds appear only in conversation with the user and in a `SEC()` helper.

## Seconds to frames

```ts
export const FPS = 30;
export const SEC = (s: number) => Math.round(s * FPS);
```

Round once, at conversion. A fractional `durationInFrames` is a bug that shows up as an off-by-one at a seam.

## `<Sequence>` rebases the clock

Inside a `<Sequence from={90}>`, `useCurrentFrame()` returns 0 at master frame 90. A scene component therefore animates from its own zero and never references its position in the film:

```tsx
<Sequence from={90} durationInFrames={150}>
  <Feature />   {/* frame 0 here === master frame 90 */}
</Sequence>
```

`durationInFrames` controls **mounting**. Past it the children unmount, which is how you stop a scene painting over the next one. Omit it and the children stay mounted to the end of the composition.

`layout="none"` removes the implicit `<AbsoluteFill>` wrapper. Use it when the child must take part in a parent flex/grid layout instead of being absolutely positioned: a lower-third inside a column, for example.

## `<Series>` for a running order

Hand-computed `from` values are a maintenance trap: changing scene 2's length means editing every later offset, and the one you miss becomes a gap or an overlap nobody notices until render.

```tsx
<Series>
  <Series.Sequence durationInFrames={SEC(3)}><Hook /></Series.Sequence>
  <Series.Sequence durationInFrames={SEC(5)}><Feature /></Series.Sequence>
  <Series.Sequence durationInFrames={SEC(4)}><Close /></Series.Sequence>
</Series>
```

`offset` shifts one entry relative to where it would land, and everything after it moves too:

- `offset={-SEC(0.5)}`: start half a second early, overlapping the previous scene. This is how you create the span a crossfade needs.
- `offset={SEC(0.25)}`: leave a quarter-second gap (black, or whatever the parent paints).

## `<TransitionSeries>` for transitions

When the boundary itself is the effect, `@remotion/transitions` handles the overlap arithmetic:

```tsx
import { TransitionSeries, linearTiming, springTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";

<TransitionSeries>
  <TransitionSeries.Sequence durationInFrames={SEC(3)}><Hook /></TransitionSeries.Sequence>
  <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
  <TransitionSeries.Sequence durationInFrames={SEC(5)}><Feature /></TransitionSeries.Sequence>
  <TransitionSeries.Transition presentation={slide()} timing={springTiming({ config: { damping: 200 } })} />
  <TransitionSeries.Sequence durationInFrames={SEC(4)}><Close /></TransitionSeries.Sequence>
</TransitionSeries>
```

The transition **consumes** frames from the two sequences it sits between: total length is the sum of the sequence durations minus each transition's duration. Budget for it, or the film comes out shorter than the storyboard says.

Do not mix `<TransitionSeries.Transition>` with a hand-authored opacity crossfade on the same boundary. They fight, and the result is a double-dip through to the background. `/seam-craft` covers why that dip shows.

## Relative timing between scenes

Deriving one scene's start from another's is a smell, because it means the assembly is encoded in two places. Put both in a `<Series>` and let the order carry the relationship.

The exception is an element that must hit a fixed moment in the film regardless of edits upstream: a logo landing on a music downbeat, say. Name that frame as a constant, and comment why:

```ts
// Music bed's first downbeat. Measured, not derived. Do not shift with edits above.
export const DOWNBEAT = 137;
```

## Timing a value inside a scene

`interpolate` maps a frame range onto a value range. Always clamp, or the value keeps going past the range:

```tsx
const opacity = interpolate(frame, [0, 12], [0, 1], {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
});
```

For an exit as well as an entrance, one call with four stops beats two calls plus a conditional:

```tsx
const opacity = interpolate(
  frame,
  [0, 12, durationInFrames - 12, durationInFrames],
  [0, 1, 1, 0],
  { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
);
```

`spring()` is the default for anything that should feel physical; `interpolate` with an easing is for anything that must land on an exact frame. `/hyperframes-animation` owns the choice and the damping numbers.
