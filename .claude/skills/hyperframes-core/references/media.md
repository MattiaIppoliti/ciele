# Media

Remotion's media components exist so the renderer can seek deterministically. A raw `<video>`, `<audio>`, or `<img>` tag renders as a frozen first frame, a silent track, or an empty box, and it does so without an error.

| Need                            | Component                                   |
| ------------------------------- | ------------------------------------------- |
| Video, in a render              | `<OffthreadVideo>`, prefer this             |
| Video needing the real element  | `<Video>`                                   |
| Audio                          | `<Audio>`                                    |
| Still image                     | `<Img>`                                      |
| Animated GIF                    | `<Gif>` from `@remotion/gif`                 |
| Embedded page                   | `<IFrame>`                                   |
| Lottie                          | `<Lottie>` from `@remotion/lottie`           |

## `staticFile` is mandatory for local assets

```tsx
import { Img, staticFile } from "remotion";

<Img src={staticFile("logo.svg")} />
```

Everything lives under `public/`, and `staticFile("logo.svg")` resolves `public/logo.svg`. A bare `"/logo.svg"` works in Studio and then 404s in a bundled or Lambda render, which is why that bug always surfaces late. Never string-concatenate a path into `staticFile` from a prop without validating it.

## `<OffthreadVideo>` over `<Video>`

`<OffthreadVideo>` extracts frames with FFmpeg outside the browser: faster, and frame-accurate in a way a seeking `<video>` element is not. Use `<Video>` only when you need the DOM element itself.

```tsx
<OffthreadVideo src={staticFile("capture/dashboard.mp4")} />
```

## Trimming and placement

Two different clocks, and mixing them up is the standard media bug:

- **Where the clip sits in the film**: `<Sequence from>` / `durationInFrames`.
- **Which part of the source plays**: `trimBefore` / `trimAfter` on the media component, in frames of the composition's fps.

```tsx
<Sequence from={SEC(4)} durationInFrames={SEC(6)}>
  <OffthreadVideo
    src={staticFile("capture/demo.mp4")}
    trimBefore={SEC(12)}   {/* start 12s into the source */}
    trimAfter={SEC(18)}    {/* stop at 18s into the source */}
  />
</Sequence>
```

Keep the `<Sequence>` window and the trim window the same length, or the clip ends early and holds a blank, or gets cut mid-motion.

## Volume

A number for a fixed level, a callback for a ramp. The callback's frame is relative to the media component's own start:

```tsx
<Audio src={staticFile("music/bed.mp3")} volume={0.16} />

<Audio
  src={staticFile("music/bed.mp3")}
  volume={(f) =>
    interpolate(f, [0, SEC(1)], [0, 0.16], { extrapolateRight: "clamp" })
  }
/>
```

Volume above 1 is not amplification you can rely on. Normalise the source in `/media-use` instead. Ducking a bed under a voiceover, effect chains, and automation envelopes belong to `/hyperframes-audio`.

## Playback rate

A constant `playbackRate` is render-safe on both `<Audio>` and `<OffthreadVideo>`:

```tsx
<OffthreadVideo src={staticFile("demo.mp4")} playbackRate={1.5} />
```

It is not keyframeable. A speed **ramp** must be preprocessed into a new source file, and `/media-use` owns that. Do not try to fake one by swapping rates between adjacent sequences; the seam is audible and the frame math stops lining up.

## Images that must not shift layout

Give every `<Img>` explicit dimensions or a sized container. An image whose intrinsic size arrives after first paint reflows its siblings, and because the renderer captures frames in parallel workers, some frames catch the pre-reflow layout and some do not. The result is a one-frame jump that looks like a corrupt render.

## Fonts

Use `@remotion/google-fonts` rather than a `<link>` to Google's CDN, because it bundles the font so the render does not depend on a network fetch landing before the frame captures:

```tsx
import { loadFont } from "@remotion/google-fonts/Inter";
const { fontFamily } = loadFont();
```

For a local font, `@font-face` in a CSS file plus `staticFile()` for the source, and call `delayRender()` around `document.fonts.ready` if text metrics matter. A font that arrives late renders the fallback for the first frames, which shows up as text jumping size once.

## Async asset work

Anything the frame depends on that is not ready at mount must hold the render open:

```tsx
import { delayRender, continueRender } from "remotion";

const [handle] = useState(() => delayRender("measuring text"));
useEffect(() => {
  measure().then(() => continueRender(handle));
}, [handle]);
```

Every `delayRender()` needs exactly one `continueRender()`. A missed one hangs the render until it times out; the timeout message names the label you passed, so always pass one.
