---
name: hyperframes-core
description: The composition contract for building one renderable Remotion project. Use for project structure, `<Composition>` registration, `<Sequence>` timing, layer/track ordering, scene components, props and schemas, framework-owned media playback, deterministic-render rules, and validation. Also covers Tailwind projects and the STORYBOARD.md / SCRIPT.md plan formats. Read before writing composition code.
---

# HyperFrames Core

**The output framework is Remotion.** A composition is a React component tree registered with `<Composition>`; the current frame is the only clock; media playback belongs to Remotion's `<Video>` / `<Audio>` components, not to the DOM.

This skill is the **technical contract**: how to build one project. The body below is the build guide; per-topic detail lives in `references/`, read on demand. Other concerns live in the sibling domain skills: `hyperframes-animation`, `hyperframes-creative`, `media-use`, `hyperframes-cli`, `hyperframes-registry`. The capability map in `/hyperframes` says what each one covers.

> **Porting note.** This contract replaced an HTML plus `data-*` plus paused-GSAP-timeline contract. If you find a project whose `index.html` carries `data-composition-id` / `data-start` / `data-duration`, or a reference file describing `window.__timelines`, you are looking at the old contract. Read `references/legacy-html-contract.md` before touching it.

## References

| File                                     | Read it to…                                                                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `references/minimal-composition.md`      | start from the smallest renderable project skeleton                                                                                             |
| `references/project-structure.md`         | lay out `src/`, split scenes into components, decide monolithic vs modular                                                                       |
| `references/timing.md`                    | convert seconds to frames, place a `<Sequence>`, use `<Series>` / `<TransitionSeries>`, time one scene relative to another                       |
| `references/layers-and-order.md`          | stack layers, control z-order, overlap two scenes on the same span                                                                                |
| `references/props-and-schemas.md`         | declare props, write the Zod schema, wire `defaultProps` and `calculateMetadata`                                                                 |
| `references/media.md`                     | place `<Video>` / `<OffthreadVideo>` / `<Audio>` / `<Img>`, trim, set volume, use `staticFile`                                                    |
| `references/determinism-rules.md`         | keep the render seekable and reproducible; the bans; async asset loading via `delayRender`                                                        |
| `references/editing-recipes.md`           | cut / trim / reorder / retime / freeze / camera / mask / crossfade / audio recipes and their limits                                              |
| `references/legacy-html-contract.md`      | recognise and migrate a project still on the old HTML + `data-*` contract                                                                        |
| `references/tailwind.md`                  | work in a Tailwind v4 project                                                                                                                    |
| `references/storyboard-format.md`         | author a `STORYBOARD.md` plan (+ the parsed manifest)                                                                                            |
| `references/review-loop.md`               | run the plan → sketch → build review passes on a live board                                                                                       |
| `references/production-loop.md`           | take an approved plan to a delivered video                                                                                                       |
| `references/brief-contract.md`            | the brief's ground rules: mode derivation, shared field registry, question invariants                                                            |
| `references/brief-format.md`              | author `BRIEF.md`                                                                                                                                 |
| `references/script-format.md`             | author the optional `SCRIPT.md` locked narration                                                                                                  |
| `references/subagent-dispatch.md`         | map subagent dispatch verbs to your harness                                                                                                      |
| `references/frame-worker-core.md`         | the shared frame-worker role contract                                                                                                            |

For animation specifics (spring configs, easing, the runtime adapters) go to `hyperframes-animation`.

## Building a composition

### The shape of a project

```
package.json          # remotion, react, react-dom; scripts for studio/render
remotion.config.ts    # render-time config (codec, image format, Tailwind/webpack overrides)
tsconfig.json
public/               # everything staticFile() resolves against
src/
  index.ts            # registerRoot(Root)
  Root.tsx            # every <Composition> lives here
  <Name>/
    index.tsx         # the composition's top-level component
    scenes/*.tsx      # one component per scene
    schema.ts         # Zod schema + inferred props type
```

`src/index.ts` is the entry point and does exactly one thing:

```ts
import { registerRoot } from "remotion";
import { Root } from "./Root";

registerRoot(Root);
```

### Register the composition

Every renderable thing is a `<Composition>` in `Root.tsx`. The `id` is what the CLI renders by name.

```tsx
import { Composition } from "remotion";
import { LaunchVideo } from "./LaunchVideo";
import { launchSchema } from "./LaunchVideo/schema";

const FPS = 30;

export const Root: React.FC = () => (
  <>
    <Composition
      id="launch"
      component={LaunchVideo}
      durationInFrames={45 * FPS}
      fps={FPS}
      width={1920}
      height={1080}
      schema={launchSchema}
      defaultProps={{ productName: "Acme", accent: "#5B8CFF" }}
    />
  </>
);
```

`durationInFrames` is the render length. It is **frames, not seconds**, and getting that wrong is the single most common authoring mistake. Derive it from a named `FPS` constant rather than writing `1350`.

### Frame is the only clock

Every animated value is a pure function of `useCurrentFrame()`. This is the contract that makes a render seekable: the renderer jumps to frame 812 cold and must get the same pixels it would get playing straight through.

```tsx
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";

export const Title: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 18 } });
  const y = interpolate(enter, [0, 1], [40, 0]);

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <h1 style={{ opacity: enter, transform: `translateY(${y}px)` }}>{text}</h1>
    </AbsoluteFill>
  );
};
```

Always clamp an `interpolate` that maps a frame range, or the value keeps extrapolating past the range and a fade-in becomes opacity 4:

```tsx
const opacity = interpolate(frame, [0, 15], [0, 1], {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
});
```

### Timing is `<Sequence>`

`<Sequence>` time-shifts its children: inside it, `useCurrentFrame()` returns 0 at the sequence's own start. That local rebasing is the whole point, because a scene component never needs to know where it sits on the master timeline.

```tsx
<AbsoluteFill>
  <Sequence durationInFrames={90}>
    <Hook />
  </Sequence>
  <Sequence from={90} durationInFrames={150}>
    <Feature />
  </Sequence>
  <Sequence from={240} durationInFrames={120}>
    <Close />
  </Sequence>
</AbsoluteFill>
```

For a run of back-to-back scenes, `<Series>` computes the offsets so a duration edit does not cascade into hand-fixing every later `from`:

```tsx
<Series>
  <Series.Sequence durationInFrames={90}><Hook /></Series.Sequence>
  <Series.Sequence durationInFrames={150}><Feature /></Series.Sequence>
  <Series.Sequence durationInFrames={120}><Close /></Series.Sequence>
</Series>
```

`<Series.Sequence offset={-15}>` pulls a scene earlier to overlap its predecessor, which is how you get a crossfade span without arithmetic. Full detail, plus `<TransitionSeries>` for presentation-based transitions, in `references/timing.md`.

### Layers replace tracks

There is no track index. Stacking is DOM order inside an `<AbsoluteFill>`: later siblings paint on top. A voiceover track, a music bed, and three visual scenes are five siblings.

```tsx
<AbsoluteFill>
  <Audio src={staticFile("music.mp3")} volume={0.18} />
  <Audio src={staticFile("vo.mp3")} />
  <Sequence durationInFrames={90}><Hook /></Sequence>
  <Sequence from={90}><Feature /></Sequence>
  <Overlay />                {/* paints on top of everything above it */}
</AbsoluteFill>
```

`<Sequence layout="none">` drops the implicit `<AbsoluteFill>` wrapper. Use it when the child must participate in the parent's flex or grid layout instead of being absolutely positioned.

### Media belongs to Remotion

Never reach for a raw `<video>`, `<audio>`, or `<img>` tag. Remotion's components are what let the renderer seek and extract frames deterministically.

| Need                          | Use                                              |
| ----------------------------- | ------------------------------------------------ |
| Video in the render           | `<OffthreadVideo src>` (prefer it)               |
| Video needing DOM-level control | `<Video src>`                                    |
| Audio                         | `<Audio src volume trimBefore trimAfter>`        |
| Still image                   | `<Img src>`                                      |
| Embedded page                 | `<IFrame src>`                                   |
| Any file under `public/`      | `staticFile("dir/name.ext")`                     |

`<OffthreadVideo>` extracts frames with FFmpeg outside the browser, which is both faster and more accurate for rendering; reach for `<Video>` only when you need the real element (for example to drive something off its `currentTime`). `staticFile()` is mandatory for local assets. A bare `"/music.mp3"` string works in Studio and then breaks in a Lambda render. Trimming, volume ramps, and playback rate are in `references/media.md`.

### Props and schema

Composition inputs are React props, typed by a Zod schema so Studio renders editable controls for them and a bad `--props` payload fails loudly instead of rendering wrong.

```ts
import { z } from "zod";
import { zColor } from "@remotion/zod-types";

export const launchSchema = z.object({
  productName: z.string(),
  accent: zColor(),
  features: z.array(z.object({ title: z.string(), body: z.string() })),
});

export type LaunchProps = z.infer<typeof launchSchema>;
```

When duration depends on the props (a feature list of unknown length, an audio file of unknown length), compute it in `calculateMetadata` rather than hardcoding a guess. See `references/props-and-schemas.md`.

## Non-negotiable rules

Silent bugs that a type-check will not catch. Full rationale in `references/determinism-rules.md`.

- **No wall clock.** No `Date.now()`, no `new Date()`, no `performance.now()`. Time comes from `useCurrentFrame()`.
- **No unseeded randomness.** `Math.random()` gives a different value per frame, which strobes. Use Remotion's `random(seed)`: same seed, same value, every frame and every render.
- **No state-driven animation.** `useState` / `useReducer` / `useEffect` must not drive anything visual. The renderer mounts frames out of order and in parallel workers; state accumulated by playing forward does not exist. Derive from `frame` instead.
- **No CSS animations, transitions, or `requestAnimationFrame`.** They run on the browser's own clock, which the renderer does not advance. Every one of them renders as a frozen first frame.
- **Await async work with `delayRender`.** A fetch, a font, a measured layout: call `delayRender()` before and `continueRender(handle)` after, or the frame captures before the work lands.
- **Clamp your interpolations.** Unclamped `interpolate` extrapolates outside the input range.
- **Absolute positioning for anything animated.** A transformed element inside normal flow drags its siblings around as it moves.

## Editing existing compositions

- Read the files first. Preserve unrelated timing, props, ids, and asset paths.
- Match the existing `Composition` `id`. The CLI, any render script, and CI all address compositions by it. Renaming one is a breaking change.
- Adding a scene: prefer `<Series>` so the offsets recompute. In a hand-offset `<Sequence>` list, fix every later `from`.
- Changing a duration: check `durationInFrames` on the `<Composition>` too. A scene that runs past the composition length is silently truncated.
- Adding a component: keep it a pure function of props and `frame`.

## Validation

Command detail is in `hyperframes-cli`.

- [ ] `npx tsc --noEmit`, so the schema and prop types actually line up
- [ ] `npx remotion still <id> out/probe.png --frame <n>` at a few scene midpoints, and look at each one
- [ ] `npx remotion studio` for review, so the user can scrub and adjust props themselves
- [ ] `npx remotion render <id>` only after the user approves
