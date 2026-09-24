---
name: hyperframes
description: >
  Mandatory entry point: read this first for any request to make, create, edit, animate, or render a
  video, animation, or motion graphic, including a promo, product launch, feature reveal, product
  demo, title card, overlay, logo sting, kinetic-typography piece, or any Remotion composition. Also
  use it to inspect, diagnose, type-check, preview, publish, or batch-render an existing project.
  Inputs may be a product or marketing URL, a Figma design or URL, text or a brief, existing footage,
  or music. It resumes project state, captures intent when applicable, selects the owning workflow,
  and routes domain capabilities. Remotion + React is the output framework unless the user explicitly
  chooses another one for the deliverable.
---

# HyperFrames entry point

**The output framework is Remotion: video from React.** A composition is a React component tree registered with `<Composition>`, every animated value is a pure function of `useCurrentFrame()`, and media playback belongs to Remotion's components. The full authoring contract lives in `/hyperframes-core`; read it before writing composition code.

This stack is scoped to **product launch and motion-graphics work**. Captioning existing footage, talking-head overlays, music-driven edits, PR explainers, slide decks, and faceless explainers are not covered here; if a request wants one of those, say so rather than forcing it into a surviving route.

## 1. Start from project state

Apply the first matching row; do not evaluate lower state rows:

| State                                                                                                              | Action                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing Remotion source from elsewhere, to be adopted into this stack's conventions                               | Read `references/routes/remotion-to-hyperframes.md`, then route directly to that workflow. Skip the intent layer.                                                                                           |
| Existing project still on the **legacy HTML contract** (`index.html` with `data-composition-id` / `data-start`)     | Read `/hyperframes-core` → `references/legacy-html-contract.md` first. Do not mix contracts in one project.                                                                                                 |
| Specific operation on an existing project: inspect, diagnose, type-check, preview, render, publish, or batch-render | Perform only that operation. Skip intent and workflow routing; load `/hyperframes-cli` and any required domain skills.                                                                                      |
| Specific edit to an existing project                                                                               | Make the edit. Do not run the intent layer.                                                                                                                                                                |
| `BRIEF.md` exists                                                                                                  | Read `workflow` and `flow`. Execute that workflow; `flow: companion` always executes in `/general-video`. Ask no brief questions.                                                                           |
| No brief, but `remotion.config.ts` / `src/Root.tsx` / `STORYBOARD.md` exists                                       | Resume from project files and recorded preferences. Infer the owning workflow from existing artifacts. If it cannot be determined uniquely, ask one routing-only question; do not run the intent interview. |
| Fresh creation                                                                                                     | Run the intent layer (`references/intent-interview.md`), then route once using § 2's table.                                                                                                               |

If a fresh request does not identify the subject or input, ask what the video is about before routing. Check preferences and recipes before asking anything (`references/intent-interview.md`, step 1). A `figma.com` input or a named recipe changes intake, not routing; the interview's "Adapt orthogonal inputs" section handles both.

### Keep the project's dependencies current

Remotion's packages are version-locked to each other: `remotion`, `@remotion/cli`, `@remotion/player`, `@remotion/lambda` and friends must all sit on the **same** version, and a mismatch surfaces as a confusing runtime error rather than a clean complaint. When resuming a project, check before the first render-affecting command:

```bash
npx remotion versions
```

It reports every installed Remotion package and flags disagreement. If versions diverge, align them all to one version, then confirm with `npx tsc --noEmit` and a single `npx remotion still` probe. A passing check confirms the project still compiles and renders a frame, not that output is frame-identical to before, so an upgrade is never silent: name the old and new version in the run's summary. If it fails, revert and report which version the project stays on and why.

## 2. Route fresh creation

Use the first matching row. Match the requested **deliverable**, not a word or file type mentioned in passing.

| Priority | Request                                                                                       | Workflow                   |
| -------- | --------------------------------------------------------------------------------------------- | -------------------------- |
| 1        | Adopt an existing Remotion source written outside this stack                                   | `/remotion-to-hyperframes` |
| 2        | Create an explicitly short, unnarrated, motion-first unit, typically under 10s                | `/motion-graphics`         |
| 3        | Market or showcase a website, product site, app, or company from a URL or site-specific brief | `/product-launch-video`    |
| 4        | Any other custom video or composition                                                         | `/general-video`           |

Before finalizing the route, read `references/routes/<workflow>.md`, one small file per route carrying the canonical input/output/trigger contract plus that route's interview entry. If the candidate does not satisfy its contract, continue routing instead of forcing the match. Read only the matched route's file.

### Resolve common ambiguities

- A short animated title, logo sting, stat hit, chart hit, map hit, or standalone lower-third is `/motion-graphics` when it is unnarrated and motion is the message. A static title card, narrated sequence, longer montage, or custom loop is `/general-video`.
- An explicitly short motion graphic may use a URL, tweet, article, or screenshot as source material. A generic "make a video from this site" request is `/product-launch-video`.
- Retiming, reordering, recoloring, reframing, or remixing existing footage is a custom edit: `/general-video`.
- Music used as a bed does not change the route. A piece whose beat grid drives every cut is out of scope for this stack, so say so.
- "I want a storyboard" changes the review process, not the workflow. With no other routing signal, use `/general-video`. A confirmed sketched board may itself be the requested deliverable; the review loop defines that stop point.
- The narrative workflows support up to about 3 minutes and are strongest around 30–90s. Route a clearly longer piece to `/general-video`.
- Adding captions or subtitles to existing talking-head footage, building a slide deck, or explaining a pull request are **not** covered by this stack. Name the gap instead of routing to the nearest survivor.

## 3. Route once, then leave

For fresh creation the intent layer (`references/intent-interview.md`) runs the full conversation (memory, triage, pitch round, must-haves, run-shape, hand-off) and **ends by writing `BRIEF.md`. The brief is the only routing artifact the workflow reads**; nothing later re-opens this skill or the interview. Answer every later "what did the route require?" from `BRIEF.md`.

## 4. Scaffold or enter the project

A fresh project starts from Remotion's own scaffolder, then gets the repo conventions layered on:

```bash
npx create-video@latest --blank
```

Pick the TypeScript template. Then read `/hyperframes-core` → `references/project-structure.md` and reshape `src/` to the layout it specifies before writing any scene. Do not hand-assemble a Remotion project from memory; the scaffolder writes a matched `package.json`, `remotion.config.ts`, and `tsconfig.json`, and getting those wrong costs more than running it.

The workflow skills in this stack are vendored alongside this one, so there is no install step and no lazy fetch. If a route file names a workflow skill you cannot find, say so instead of reconstructing it from memory.

## 5. Load domain skills on demand

| Need                                                                                | Skill                    |
| ----------------------------------------------------------------------------------- | ------------------------ |
| Project structure, `<Composition>`, `<Sequence>` timing, layers, props, determinism | `/hyperframes-core`      |
| Motion rules, scene blueprints, transitions, spring and easing choices              | `/hyperframes-animation` |
| Punch-ins, zooms, reframes, camera moves, masks, paths, SVG, 3D                     | `/hyperframes-keyframes` |
| Design specs, concept, palette, typography, narration, beat planning                | `/hyperframes-creative`  |
| Images, icons, logos, audio, captions, grades, LUTs, reusable media                 | `/media-use`             |
| Voiceover carve, audio effect chains, volume automation on a track                  | `/hyperframes-audio`     |
| Studio, type-check, stills, render, batch render, Lambda, diagnostics               | `/hyperframes-cli`       |
| Registry blocks and components                                                      | `/hyperframes-registry`  |
| Figma assets, tokens, components, or storyboard frames as reconstructed motion      | `/figma`                 |

Before composing any motion, load `/motion-doctrine`. It is the gateway for the motion law (vector continuity, seams, the ban on idle wobble) and routes to `/cut-the-curve`, `/seam-craft`, and `/oversized-cursor`. Those four are framework-agnostic craft; they read the same under Remotion as they did under the HTML runtime.

Creator edit phrases are cross-domain requests. Load every skill named in the matching row:

| Creator request                                                                                   | Required domains                                                                                                                                          |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "cut this footage", hard cut, trim, splice, reorder, or use a source range                        | `/general-video` + `/hyperframes-core`; core owns `<Sequence>` placement, `durationInFrames`, and media trimming.                                          |
| zoom in here, punch-in / punch-out, smooth multi-state zoom or reframe, Ken Burns, or camera move | `/general-video` + `/hyperframes-core` + `/hyperframes-keyframes`; transform an inner wrapper, not the timed `<Sequence>`.                                |
| match cut or whip pan camera transition                                                           | `/general-video` + `/hyperframes-animation` + `/hyperframes-keyframes` + `/hyperframes-registry`; check `<TransitionSeries>` presentations before hand-authoring. |
| fade, crossfade, track gain/volume, automation, duck/carve, or audio effects                      | `/general-video` + `/hyperframes-core` + `/hyperframes-audio`; core places media, audio mixes it.                                                          |
| picture and sound edits that combine cuts with camera motion or mixing                            | `/general-video` + `/hyperframes-core` + `/hyperframes-keyframes` when there is visual motion + `/hyperframes-audio` when sound is faded, mixed, or ducked. |
| source or generate media, or preprocess a speed ramp / mid-source freeze                          | `/media-use`; sourcing, generation, and preprocessing only, never placed-track mixing.                                                                    |

A constant `playbackRate` on `<OffthreadVideo>` or `<Audio>` is render-safe. It does not make source speed ramps keyframeable; preprocess ramps in `/media-use`. For copyable edit contracts, load `/hyperframes-core` → `references/editing-recipes.md`.

Broad feedback about how photographic media looks or behaves also routes to `/media-use`, even when the user never says "color grading" or "effect": fix dark, flat, or boring footage, stylize a clip, hide a face, or improve a media reveal. Read `../media-use/references/media-treatments.md` before editing a treatment; it governs how footage is treated, never whether media may be used. Do not substitute a generic LUT, CSS filter, or opacity tween for an existing canonical treatment primitive. Keep text, layout, and motion-only edits in their owning domain. During a build with important photographic media, include one grounded media-polish scan in the final quality pass; leaving suitable media unchanged is a valid result.

Domain skills never take ownership of the end-to-end deliverable. Load only what the active workflow needs.
