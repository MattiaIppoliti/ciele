# Editing recipes

Truthful recipes for the edits users ask for by name, and the limits of each. Every duration is frames; `SEC()` converts.

## Hard cut

Two adjacent `<Series.Sequence>` entries. Nothing else: no fade, no overlap.

```tsx
<Series>
  <Series.Sequence durationInFrames={SEC(2)}><A /></Series.Sequence>
  <Series.Sequence durationInFrames={SEC(3)}><B /></Series.Sequence>
</Series>
```

## Trim a source clip

`trimBefore` / `trimAfter` pick the source range; the `<Sequence>` picks where it lands. Keep the two windows the same length. See `media.md`.

## Reorder scenes

Move the `<Series.Sequence>` entries. Because each scene animates from its own rebased frame 0, a reorder needs no timing edits. That is the payoff for keeping scenes ignorant of their position.

## Retime a scene

Change its `durationInFrames`. Under `<Series>` everything after it shifts automatically. Then check the composition's own `durationInFrames`: a film that now runs longer than the `<Composition>` declares is silently truncated.

Retiming a scene does **not** rescale its internal animation. A scene whose beats were tuned for 90 frames will hold on its last state if you give it 150. Either scale the internal constants or accept the hold deliberately.

## Freeze a frame

```tsx
import { Freeze } from "remotion";

<Freeze frame={45}>
  <Scene />
</Freeze>
```

Everything inside sees frame 45 forever. For a freeze partway through a clip, put the live portion and the frozen portion in adjacent sequences.

## Crossfade

Overlap the two scenes and fade the incoming one in:

```tsx
<Series>
  <Series.Sequence durationInFrames={SEC(3)}><A /></Series.Sequence>
  <Series.Sequence durationInFrames={SEC(3)} offset={-15}><B /></Series.Sequence>
</Series>
```

`B` fades itself in over its first 15 frames. Do not also fade `A` out, or the background shows through the middle of the dip, which on a dark film reads as a flash. `/seam-craft` explains the guard.

For a named transition (wipe, slide, clock wipe), use `<TransitionSeries>` instead of hand-authoring. See `timing.md`.

## Punch-in / zoom / Ken Burns

Transform an inner wrapper, never the timed `<Sequence>`:

```tsx
const scale = interpolate(frame, [0, SEC(4)], [1, 1.12], {
  extrapolateRight: "clamp",
});

<AbsoluteFill style={{ overflow: "hidden" }}>
  <AbsoluteFill style={{ transform: `scale(${scale})` }}>
    <OffthreadVideo src={staticFile("demo.mp4")} />
  </AbsoluteFill>
</AbsoluteFill>
```

The outer fill clips; the inner one moves. Transforming the `<Sequence>` wrapper instead fights Remotion's own layout. `/hyperframes-keyframes` owns multi-state zooms and camera paths.

## Reframe / crop

Size and position an inner wrapper larger than the frame, and clip with `overflow: hidden` on the outer. Animating `objectPosition` on the media is the cheaper route for a simple pan.

## Speed change

Constant: `playbackRate` on the media component. A **ramp** is not expressible; preprocess a new source file in `/media-use`. Do not chain sequences at different rates; the seam is audible and the frame math drifts.

## Audio fade

A `volume` callback, not a CSS transition:

```tsx
<Audio
  src={staticFile("bed.mp3")}
  volume={(f) => interpolate(f, [0, SEC(1)], [0, 0.18], { extrapolateRight: "clamp" })}
/>
```

Ducking under a voiceover, effect chains, and automation envelopes: `/hyperframes-audio`.

## Mask / reveal

`clipPath` driven by the frame. It interpolates cleanly and, unlike an SVG mask, does not need a separate defs tree:

```tsx
const pct = interpolate(frame, [0, SEC(1)], [0, 100], { extrapolateRight: "clamp" });
<div style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}>…</div>
```

## What is not expressible here

Say so rather than approximating:

- Speed ramps within one source clip (preprocess).
- Frame-accurate audio-driven cuts without a beat grid (`/media-use` to extract one first).
- Anything that needs a running clock rather than a frame function.
