# Project structure

## The layout

```
package.json
remotion.config.ts
tsconfig.json
public/                     # staticFile() resolves against this, and only this
src/
  index.ts                  # registerRoot(Root), nothing else
  Root.tsx                  # every <Composition> registration
  <CompositionName>/
    index.tsx               # the composition's top-level component
    schema.ts               # Zod schema + inferred props type
    constants.ts            # FPS, palette, timing constants
    scenes/
      Hook.tsx
      Feature.tsx
      Close.tsx
    components/             # shared across scenes of this composition
  shared/                   # shared across compositions
```

One directory per composition. A project with three deliverables (a 45s launch film, a 6s logo sting, a square cutdown) has three directories and three `<Composition>` entries, sharing what genuinely overlaps through `src/shared/`.

## Monolithic or modular

Write one file until it hurts, then split by **scene**, because scenes are what the storyboard, the review notes, and the user's feedback all address. Splitting by visual element ("all the text", "all the backgrounds") produces files nobody can map onto the video.

Rules of thumb:

- Under ~150 lines and one scene: keep it in `index.tsx`.
- More than one scene: one file per scene under `scenes/`, and `index.tsx` becomes the assembly: the `<Series>` or `<Sequence>` list and nothing else.
- A component used by two scenes moves to `components/`. A component used by two compositions moves to `src/shared/`.

## The assembly file

`index.tsx` should read as the shape of the video. Someone who opens it should see the running order without reading a scene file:

```tsx
import { AbsoluteFill, Audio, Series, staticFile } from "remotion";
import { Hook } from "./scenes/Hook";
import { Feature } from "./scenes/Feature";
import { Close } from "./scenes/Close";
import { SEC } from "./constants";
import type { LaunchProps } from "./schema";

export const LaunchVideo: React.FC<LaunchProps> = ({ features, accent }) => (
  <AbsoluteFill style={{ backgroundColor: "#0B0D12" }}>
    <Audio src={staticFile("music/bed.mp3")} volume={0.16} />
    <Series>
      <Series.Sequence durationInFrames={SEC(3)}>
        <Hook accent={accent} />
      </Series.Sequence>
      <Series.Sequence durationInFrames={SEC(5)} offset={-SEC(0.5)}>
        <Feature items={features} />
      </Series.Sequence>
      <Series.Sequence durationInFrames={SEC(4)}>
        <Close accent={accent} />
      </Series.Sequence>
    </Series>
  </AbsoluteFill>
);
```

Keep a `SEC()` helper in `constants.ts` rather than scattering `* 30` through the tree:

```ts
export const FPS = 30;
export const SEC = (s: number) => Math.round(s * FPS);
```

It also means a change to 60fps is one edit, not a hunt.

## Scene components take props, not context

A scene reads `useCurrentFrame()` (already rebased to its own start by the enclosing `<Sequence>`) and its props. It does not know its `from` offset, its index in the running order, or what plays after it. That is what makes a scene reorderable, which is the whole point of the split.

If a scene needs to know something about its neighbours, that knowledge belongs in the assembly file, passed down as a prop.

## `remotion.config.ts`

Render-time configuration only: codec, image format, webpack overrides. It is not read during a render started through `@remotion/renderer` APIs, only by the CLI, which surprises people who move from the CLI to a script.

```ts
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setCodec("h264");
```
