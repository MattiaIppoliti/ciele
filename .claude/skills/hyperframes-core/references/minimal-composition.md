# Minimal renderable composition

The smallest project that renders. Four files. Everything else is addition.

## `package.json`

Let `npx create-video@latest --blank` write this. It pins `remotion`, `@remotion/cli`, `react`, and `react-dom` at versions that agree with each other, which is the part that goes wrong when hand-written.

```json
{
  "scripts": {
    "studio": "remotion studio",
    "render": "remotion render",
    "typecheck": "tsc --noEmit"
  }
}
```

## `src/index.ts`

```ts
import { registerRoot } from "remotion";
import { Root } from "./Root";

registerRoot(Root);
```

One job. Never put a `<Composition>` here.

## `src/Root.tsx`

```tsx
import { Composition } from "remotion";
import { Main } from "./Main";

const FPS = 30;

export const Root: React.FC = () => (
  <>
    <Composition
      id="main"
      component={Main}
      durationInFrames={5 * FPS}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ title: "Hello" }}
    />
  </>
);
```

`durationInFrames` is frames. `5 * FPS` is five seconds. Writing `5` here gives you a five-frame video, which reads as a broken render rather than a wrong number.

## `src/Main.tsx`

```tsx
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

export const Main: React.FC<{ title: string }> = ({ title }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0B0D12",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <h1 style={{ color: "white", fontSize: 96, opacity }}>{title}</h1>
    </AbsoluteFill>
  );
};
```

## Confirm it

```bash
npx tsc --noEmit
npx remotion still main out/probe.png --frame=30
```

Look at `out/probe.png`. A passing type-check is not evidence that anything is on screen.

## Why `<AbsoluteFill>` and not a `<div>`

`<AbsoluteFill>` is `position: absolute; inset: 0; display: flex; flex-direction: column`. It guarantees a full-frame box with a resolved size, which is what animated children need. A transformed element inside normal document flow shoves its siblings around as it moves. Reach for a plain `<div>` only inside an `<AbsoluteFill>` that has already established the box.
