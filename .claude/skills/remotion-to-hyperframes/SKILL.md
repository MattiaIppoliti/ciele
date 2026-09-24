---
name: remotion-to-hyperframes
description: >
  Bring existing composition source into this stack. Two jobs: adopt an outside Remotion (React)
  project into this stack's conventions, or migrate a legacy HTML + `data-*` + GSAP-timeline project
  to Remotion. Use ONLY on an explicit ask to port, convert, migrate, or adopt existing source. A
  passing Remotion mention, reference-only code, or "make something like my other video" is a fresh
  build (/general-video). Unclear → /hyperframes.
---

# Porting source into this stack

> **The front door is `/hyperframes`.** Use this only for existing source that has to move. Authoring
> something new, re-creating from a non-source reference (After Effects, a Framer Motion demo, a video
> file), or any uncertainty → read `/hyperframes` first; the intent layer owns every route decision.

## The name is historical

This skill used to translate Remotion → HyperFrames HTML, back when HTML was this stack's output
contract. **The direction has inverted.** Remotion *is* the contract now (`/hyperframes-core`), so
there is nothing to translate Remotion *into*. What remains are two real jobs:

| Job                                                                             | What to do                                                                                      |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Adopt** an outside Remotion project (someone else's repo, a template, a fork)  | Normalise it onto this stack's conventions. § Adopting below.                                    |
| **Migrate** a legacy HTML-contract project (`data-composition-id`, GSAP timeline) | The old mapping tables in `references/`, read right-to-left. Start at `/hyperframes-core` → `references/legacy-html-contract.md`. |

The `references/` files below still describe the mapping in the **old** direction (Remotion on the
left, HTML on the right). They are still the most complete mapping that exists, so read them in
reverse for a migration. `api-map.md` is the index.

## Adopting an outside Remotion project

The source already renders, so nothing here is a translation — it is a normalisation. Do the smallest
set of these that the project actually needs, and say which ones you did:

1. **Check the versions agree.** `npx remotion versions`. Mismatched Remotion packages are the most
   common reason an adopted project fails in a way that looks like a code bug.
2. **Type-check before touching anything.** `npx tsc --noEmit`, so you can tell inherited errors from
   the ones you introduce.
3. **Reshape `src/` only if it fights the conventions.** `/hyperframes-core` → `references/project-structure.md`.
   A project that already reads clearly does not need moving; churn for its own sake loses git history.
4. **Add a Zod schema** to any `<Composition>` that has none, inferring the type from the schema rather
   than keeping a hand-written `interface`. `/hyperframes-core` → `references/props-and-schemas.md`.
5. **Hunt the determinism violations.** This is the one pass always worth running: outside projects
   routinely carry `Math.random()`, CSS transitions, and state-driven animation that happen to look
   fine while scrubbing. Run the checklist in `/hyperframes-core` → `references/determinism-rules.md`,
   and prove it with two cold renders of the same late frame.
6. **Replace hardcoded asset paths** with `staticFile()`, which is what breaks first in a Lambda render.

Do not restyle, re-time, or "improve" the motion while adopting. Adoption and creative change are
separate asks, and mixing them makes the diff unreviewable.

## Migrating a legacy HTML project

Read `/hyperframes-core` → `references/legacy-html-contract.md` first: it decides whether the project
should be migrated at all (a two-word copy fix does not justify a rewrite), then gives the mapping and
the order of work. Come back here for the per-topic detail — `timing.md`, `sequencing.md`,
`transitions.md`, `media.md`, `fonts.md`, `parameters.md` — reading each table right-to-left.

Expect the eases to be the least faithful part of any migration. GSAP's named eases and Remotion's
springs do not correspond exactly; match by eye, and tell the user where you approximated.

## The test corpus grades the retired direction

`assets/test-corpus/` (T1–T4) renders a Remotion baseline, renders an HTML translation, and compares
by SSIM. The HTML half of that no longer means anything, so **the corpus does not currently gate this
skill.** Its Remotion fixtures are still useful as adoption practice material. Do not report a corpus
score as evidence that a migration is correct; probe stills and compare them yourself instead.

## Legacy workflow: Remotion → HTML (retired direction)

Everything below runs the **old** direction and emits the retired HTML contract. It is kept because
its per-step reasoning is the clearest record of how the two models differ, which is what you need
when migrating the other way.

**Do not execute these steps against a project in this stack.** They produce `index.html`, not TSX,
and they call the retired `hyperframes` CLI. Read them for the reasoning; act through the two live
sections above.


### Step 1: Lint the source

Run [`scripts/lint_source.py`](scripts/lint_source.py) over the Remotion source directory. The lint detects patterns that can't translate cleanly:

- **Blockers** (refuse + recommend interop): `useState`, `useReducer`, `useEffect`/`useLayoutEffect` with non-empty deps, async `calculateMetadata`, third-party React UI libraries (MUI, Chakra, Mantine, antd, shadcn, Radix, NextUI).
- **Warnings** (translate after dropping the construct): `@remotion/lambda` config, `delayRender`, `useCallback`, `useMemo`, custom hooks.
- **Info** (translate with note): `staticFile`, `interpolateColors`.

If any blocker fires, **stop**. Read [`references/escape-hatch.md`](references/escape-hatch.md) and surface the recommendation message. Warnings don't stop translation — drop the offending construct in step 3 and note the gap in `TRANSLATION_NOTES.md`. `@remotion/lambda` config is the canonical warning case: the skill drops the import + `renderMediaOnLambda(...)` calls but translates the rest of the composition.

### Step 2: Plan the translation

Read [`references/api-map.md`](references/api-map.md) — the index of every Remotion API and its HF equivalent or per-topic reference. Identify which topic references you'll need based on what the source uses:

| Source contains                                                           | Load reference                                |
| ------------------------------------------------------------------------- | --------------------------------------------- |
| `Composition`, `defaultProps`, `schema`, `calculateMetadata`              | [`parameters.md`](references/parameters.md)   |
| `Sequence`, `Series`, `Loop`, `AbsoluteFill`, `Freeze`                    | [`sequencing.md`](references/sequencing.md)   |
| `useCurrentFrame`, `interpolate`, `spring`, `Easing`, `interpolateColors` | [`timing.md`](references/timing.md)           |
| `Audio`, `Video`, `Img`, `IFrame`, `staticFile`, `delayRender`            | [`media.md`](references/media.md)             |
| `TransitionSeries`, `@remotion/transitions`                               | [`transitions.md`](references/transitions.md) |
| `@remotion/lottie`                                                        | [`lottie.md`](references/lottie.md)           |
| `@remotion/google-fonts/<Family>`, `Font.loadFont`, `@font-face`          | [`fonts.md`](references/fonts.md)             |

Don't load all of them — load only what the specific source needs.

### Step 3: Generate the HF composition

Emit `index.html` with:

- Root `<div id="stage">` carrying the composition's `data-composition-id`, `data-start="0"`, `data-duration` (in seconds), `data-fps`, `data-width`, `data-height`, plus one `data-*` per scalar prop.
- A flat list of scene divs with `data-start` / `data-duration` / `data-track-index`.
- Inline `<style>` for layout; CSS sets the `from` state of every animated property.
- A single `<script>` tag at the bottom containing one paused `gsap.timeline({paused: true})`. Every Remotion `useCurrentFrame()` derivation becomes a tween on this timeline at the right offset.
- `window.__timelines["<composition-id>"] = tl;` registers the timeline with HF's runtime.

Custom React subcomponents inline as repeated HTML using the prop interface as the template (see [`parameters.md`](references/parameters.md) for the per-instance `data-*` pattern).

### Step 4: Validate

Run the eval harness — [`references/eval.md`](references/eval.md) for the full guide. Quick path:

```bash
# Render Remotion baseline (after npm install in the fixture)
cd remotion-src && npx remotion render <CompositionId> out/baseline.mp4

# Render HF translation
cd ../hf-src && npx hyperframes render --skill=remotion-to-hyperframes --output ../hf.mp4

# SSIM diff
../../scripts/render_diff.sh ./remotion-src/out/baseline.mp4 ./hf.mp4 ./diff
```

Threshold: ~0.02 below `p05` of the source's complexity tier (see `eval.md`'s validated thresholds table). If the diff fails, run [`scripts/frame_strip.sh`](scripts/frame_strip.sh) to see _which_ frames diverged, then re-read the relevant timing/sequencing/media reference.

**Critical**: both renders must use matching pixel format. Set `Config.setVideoImageFormat("png")` + `Config.setColorSpace("bt709")` in the Remotion source's `remotion.config.ts` — otherwise the diff measures encoder differences (~0.05 SSIM hit), not translation fidelity.

### Step 5: Document gaps

Anything that didn't translate cleanly (volume ramps dropped, custom presentations approximated, fonts substituted) gets a `TRANSLATION_NOTES.md` written next to the HF output. See [`references/limitations.md`](references/limitations.md) for the format.

## What this skill explicitly does NOT do

- **Translate React state machines.** Compositions that drive animation via `useState` + `useEffect` are not deterministic frame-capture targets in HyperFrames' seek-driven model. Recommend the runtime interop pattern.
- **Run Remotion's render pipeline alongside HyperFrames.** That's the runtime interop pattern from [PR #214](https://github.com/heygen-com/hyperframes/pull/214) — a separate solution for compositions that fail this skill's lint.

(`@remotion/lambda` is _not_ a blocker — Lambda config is deployment, not animation. The skill drops it as a warning and translates the rest. See [`references/escape-hatch.md`](references/escape-hatch.md).)

## How to grade your own translation

Run the test corpus orchestrator:

```bash
./assets/test-corpus/run.sh
```

It runs T1, T2, T3 (render + diff) and T4 (lint validation), prints a per-tier pass/fail table, and emits an aggregate JSON report. Use this to verify the skill is working end-to-end on a clean checkout — and as a regression check after editing any reference.

Validated baseline (as of 2026-04-27):

| Tier | Composition shape                           | Mean SSIM | Threshold |
| ---- | ------------------------------------------- | --------- | --------- |
| T1   | single-element fade-in                      | 0.974     | 0.95      |
| T2   | multi-scene + spring + audio + image        | 0.985     | 0.95      |
| T3   | data-driven, custom subcomponents, count-up | 0.953     | 0.90      |
| T4   | escape-hatch (8 lint cases)                 | 8/8 pass  | n/a       |
