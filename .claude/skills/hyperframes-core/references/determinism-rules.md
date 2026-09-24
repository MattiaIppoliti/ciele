# Determinism rules

The renderer does not play the video. It mounts a frame, captures it, throws the tree away, and does that again, across several parallel workers, in an order you do not control. Frame 812 may be captured before frame 3.

So the contract is: **the output at frame N must be a pure function of N and the props.** Every rule below follows from that one sentence, and every violation produces a render that looks fine while scrubbing in Studio and wrong on disk.

## Banned

### Wall clocks

No `Date.now()`, `new Date()`, `performance.now()`. They advance in real time, which has nothing to do with frame number, so parallel workers disagree with each other.

If the video must display a date, pass it as a prop.

### Unseeded randomness

`Math.random()` returns a new value on every mount, so a starfield re-scatters every frame and reads as static noise.

```tsx
import { random } from "remotion";

const stars = new Array(80).fill(0).map((_, i) => ({
  x: random(`star-x-${i}`) * width,
  y: random(`star-y-${i}`) * height,
}));
```

`random(seed)` with the same seed always returns the same number. Seed with something stable and unique: an index, a string key. Seeding with the frame is legitimate only when you actually want per-frame variation, like film grain.

### State-driven animation

`useState`, `useReducer`, and `useEffect` must not drive anything visual. State built up by playing forward does not exist when the renderer jumps straight to frame 812.

```tsx
// Broken: count depends on how many times this mounted.
const [count, setCount] = useState(0);
useEffect(() => { setCount((c) => c + 1); }, [frame]);

// Correct: derived from the frame.
const count = Math.floor(interpolate(frame, [0, 60], [0, 100], {
  extrapolateRight: "clamp",
}));
```

`useState` is fine for a `delayRender` handle or a measured value that then holds the render open. It is not fine as an animation clock.

### CSS animations, transitions, and `requestAnimationFrame`

All three run on the browser's clock, which the renderer never advances. Every one of them captures as a frozen first frame.

```tsx
// Broken.
<div style={{ transition: "opacity 300ms", opacity: shown ? 1 : 0 }} />
<div className="animate-pulse" />

// Correct.
<div style={{ opacity: interpolate(frame, [0, 9], [0, 1], { extrapolateRight: "clamp" }) }} />
```

This includes Tailwind's `animate-*` and `transition-*` utilities, and any component library that animates internally (most carousels, accordions, and toast libraries). If a third-party component animates itself, it will not render.

### Infinite loops

No `repeat: Infinity` equivalents. `<Loop>` needs a bounded `durationInFrames`; a loop with no end has no defined value at an arbitrary frame.

### Unclamped `interpolate`

```tsx
// At frame 100 this is opacity 6.67.
interpolate(frame, [0, 15], [0, 1]);

// Correct.
interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });
```

`interpolate` extrapolates outside its input range by default. Clamp both ends unless you specifically want the extrapolation.

### Network requests in components

A `fetch` in a component body races the frame capture. Data fetching goes in `calculateMetadata`, which is awaited before any frame renders, and arrives as props.

## Required

### Hold the render open for async work

```tsx
const [handle] = useState(() => delayRender("loading chart data"));
useEffect(() => {
  load().then(() => continueRender(handle));
}, [handle]);
```

One `continueRender` per `delayRender`. Always pass a label. The timeout error quotes it, and that is the difference between a five-minute diagnosis and a fifty-minute one.

### Absolute positioning for anything animated

A transformed element in normal flow drags its siblings. Animate inside an `<AbsoluteFill>` or an explicitly positioned box.

### Explicit sizes on media and text containers

An asset whose intrinsic size lands after first paint reflows the layout. Some workers capture the pre-reflow layout, some the post, giving a single-frame jump that reads as a corrupt render. Give images dimensions and long text a fixed box.

### Unmount, do not hide

Bound a `<Sequence>` with `durationInFrames` to stop a layer painting. Never animate `display`, and never tween `visibility`.

## Verifying

A render that looks right while scrubbing forward in Studio proves nothing about determinism, because scrubbing forward is the one access pattern that hides all of these bugs. Instead:

```bash
npx remotion still main out/a.png --frame=812
npx remotion still main out/b.png --frame=812
cmp out/a.png out/b.png
```

Two cold renders of the same frame must be byte-identical. If they are not, something above is being violated. Also probe a late frame **first**, before ever playing the film. That is the renderer's access pattern, and it flushes out state-driven animation immediately.
