# The legacy HTML contract

This stack used to render video from HTML: an `index.html` whose DOM declared timing with `data-*` attributes, animated by exactly one paused GSAP timeline registered at `window.__timelines["<id>"]`, rendered by a `hyperframes` CLI. That contract is retired. The current one is Remotion; see this skill's `SKILL.md`.

## Recognising a legacy project

Any one of these is conclusive:

- An `index.html` with `data-composition-id`, `data-start`, `data-duration`, or `data-track-index`.
- `class="clip"` on timed elements.
- `window.__timelines`, or `gsap.timeline({ paused: true })`.
- A `hyperframes.json`, or `package.json` scripts calling `npx hyperframes`.
- `hf-src/` as a source directory.

## Do not mix contracts

A project is one or the other. Adding a `src/Root.tsx` to a project that still renders through `index.html` produces a tree nothing renders and a second source of truth for the timing. If a legacy project needs work, either keep it on the legacy contract or convert it wholesale.

## Deciding: keep or convert

Keep it legacy when the ask is a small, bounded edit (a copy change, a color, one duration) and the old CLI still runs. Converting for a two-word fix is not a favour to anyone.

Convert when the ask is structural (new scenes, a re-cut, a different aspect ratio), when the old CLI no longer runs, or when the user asks for it. Say which you are doing and why before you start.

## The conversion mapping

Inverting the old translation table. `/remotion-to-hyperframes` holds the fuller per-topic detail; it reads in this direction too.

| Legacy HTML                                                   | Remotion                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| root `<div data-composition-id data-width data-height data-fps data-duration>` | `<Composition id width height fps durationInFrames>` in `Root.tsx`     |
| `data-duration="3.5"` (seconds)                               | `durationInFrames={SEC(3.5)}`; convert, do not paste                  |
| `data-start` on a clip                                        | `<Sequence from>`                                                       |
| `class="clip"` + `data-duration`                              | `<Sequence durationInFrames>`                                          |
| `data-track-index="2"`                                        | sibling order inside `<AbsoluteFill>`; higher index paints later        |
| sub-composition via `data-composition-src` + `<template>`     | a React component; the `<template>` transport rule stops existing       |
| `data-*` scalars used as variables                            | props, typed by a Zod schema                                           |
| `window.__timelines["id"]` paused GSAP timeline               | delete it; every value becomes a function of `useCurrentFrame()`         |
| `gsap.fromTo(el, {x:-40}, {x:0, duration:0.5, ease:"none"})`   | `interpolate(frame, [0, SEC(0.5)], [-40, 0], {extrapolate…: "clamp"})`  |
| `ease: "back.out(1.7)"`                                       | `spring({frame, fps, config:{damping}})`; retune by eye, not by table  |
| `<video data-start data-duration>` / `<audio data-volume>`     | `<OffthreadVideo>` / `<Audio volume>` inside a `<Sequence>`             |
| `assets/x.png`                                                | `public/x.png` + `staticFile("x.png")`                                  |
| `data-hidden`                                                 | remove the element, or bound its `<Sequence>` to zero frames            |
| `npx hyperframes check`                                       | `npx tsc --noEmit` + `npx remotion still` probes                        |
| `npx hyperframes render`                                      | `npx remotion render <id>`                                              |

## Order of work

1. Read the whole `index.html` and inventory every timed element with its start, duration, and track index. Do this before writing any TSX, because the timing is the part that gets silently lost.
2. Register one `<Composition>` matching the root's dimensions, fps, and duration.
3. Rebuild scene by scene, converting each element's absolute `data-start` into a `<Sequence from>`, then rebasing every animation inside it to that sequence's frame 0.
4. Convert media, then assets into `public/`.
5. Probe stills at the old scene midpoints and compare against the legacy render if one exists.

Expect the eases to be the least faithful part. GSAP's named eases and Remotion's springs do not map exactly; match by eye and tell the user where you approximated.
