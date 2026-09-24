# Tailwind

## Setup

Remotion has a first-party Tailwind integration; wiring webpack by hand is not worth it.

```bash
npx remotion install tailwind
```

Or, on a fresh project, pick the Tailwind template from `npx create-video@latest`. The install command writes the webpack override into `remotion.config.ts`:

```ts
import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind-v4";

Config.overrideWebpackConfig(enableTailwind);
```

Import the stylesheet once, from the file that registers the root:

```ts
// src/index.ts
import "./index.css";
import { registerRoot } from "remotion";
import { Root } from "./Root";

registerRoot(Root);
```

## The rule that matters

**Tailwind's animation and transition utilities do not render.** `animate-pulse`, `animate-spin`, `animate-bounce`, `transition-*`, `duration-*`, `ease-*` all run on the browser's clock, which the renderer never advances. They capture as a frozen first frame, and nothing warns you.

```tsx
// Broken: renders one frozen frame.
<div className="animate-pulse opacity-0 transition-opacity duration-300" />

// Correct: Tailwind for the static styling, inline style for the animated value.
<div
  className="rounded-2xl bg-slate-900 p-8"
  style={{ opacity: interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" }) }}
/>
```

The division to hold to: **Tailwind classes for everything static, inline `style` for everything that changes with the frame.** Mixing an animated property between the two (a `scale-105` class and a frame-driven `transform`) means the class and the inline value fight, and which wins depends on specificity rather than intent.

## Fixed pixel sizes, not responsive utilities

A composition renders at exactly one size. Responsive prefixes (`md:`, `lg:`) are dead weight at best; at worst they make the layout depend on a breakpoint that the render happens to sit on.

Type scale is the common trap: `text-6xl` was designed for a 1280px-wide page, not a 1920×1080 frame that will be watched at a distance. Set video type sizes explicitly (`text-[96px]`, or an inline `fontSize`) and check against a still.

## Fonts

Tailwind's `font-sans` resolves to a system font stack, which differs between your machine and a Lambda render container, so text metrics shift and the layout moves. Load the font explicitly with `@remotion/google-fonts` and set the family, rather than trusting the stack.

## Arbitrary values are fine

`w-[1920px]`, `text-[96px]`, `bg-[#0B0D12]` all work and are often clearer than extending the theme for a one-off composition. Extend the theme when a value is genuinely the brand's, and keep those in one place so `/hyperframes-creative` has something to point at.
