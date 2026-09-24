# Props and schemas

Composition inputs are React props. Typing them with Zod buys three things: editable controls in Studio, a loud failure on a bad `--props` payload, and one source of truth for the TypeScript type.

## Declare the schema

```ts
// src/LaunchVideo/schema.ts
import { z } from "zod";
import { zColor } from "@remotion/zod-types";

export const launchSchema = z.object({
  productName: z.string(),
  tagline: z.string(),
  accent: zColor(),
  features: z.array(
    z.object({
      title: z.string(),
      body: z.string(),
    }),
  ),
});

export type LaunchProps = z.infer<typeof launchSchema>;
```

Infer the type from the schema. Declaring an `interface` next to a schema guarantees they drift, and the drift surfaces as a render that succeeds with the wrong content.

`zColor()` from `@remotion/zod-types` gives Studio a real color picker instead of a text field. There is a matching `zTextarea()` for long copy.

## Wire it up

```tsx
<Composition
  id="launch"
  component={LaunchVideo}
  schema={launchSchema}
  defaultProps={{
    productName: "Acme",
    tagline: "Ship faster",
    accent: "#5B8CFF",
    features: [{ title: "Fast", body: "Really fast" }],
  }}
  durationInFrames={SEC(45)}
  fps={FPS}
  width={1920}
  height={1080}
/>
```

`defaultProps` must satisfy the schema completely, because it is the payload Studio opens with and the baseline `--props` overrides. Remotion type-checks it against the schema, so a missing field is a compile error rather than a runtime surprise.

## Override at render time

```bash
npx remotion render launch out/v.mp4 --props='{"productName":"Contoso"}'
npx remotion render launch out/v.mp4 --props=./props/contoso.json
```

Overrides merge at the top level only. Passing `features` replaces the whole array rather than merging into it.

## Duration that depends on the props

Hardcoding `durationInFrames` when the content length varies produces either a truncated film or dead air. Compute it:

```tsx
import type { CalculateMetadataFunction } from "remotion";

export const calculateLaunchMetadata: CalculateMetadataFunction<LaunchProps> = ({ props }) => {
  const intro = SEC(3);
  const perFeature = SEC(4);
  const outro = SEC(4);

  return {
    durationInFrames: intro + props.features.length * perFeature + outro,
  };
};
```

```tsx
<Composition id="launch" calculateMetadata={calculateLaunchMetadata} /* … */ />
```

`calculateMetadata` may be async. That is the sanctioned place to fetch data or measure an audio file, and the only place async work belongs at the composition level. It can return `props` too, so a fetch result reaches the component as a normal prop:

```tsx
export const calculateMetadata: CalculateMetadataFunction<Props> = async ({ props }) => {
  const { durationInSeconds } = await getAudioDurationInSeconds(props.voiceover);
  return {
    durationInFrames: Math.ceil(durationInSeconds * FPS),
    props,
  };
};
```

## What does not belong in props

- **Timing constants.** `SEC(3)` for the hook belongs in `constants.ts`. Exposing it as a prop invites a payload that desyncs the film from its music.
- **Anything derived.** If a value is computable from another prop, compute it in the component.
- **Asset paths that never change.** Use `staticFile()` directly. Props are for what varies between renders.
