---
name: hyperframes-cli
description: Drive the Remotion CLI development loop: scaffold, studio, type-check, compositions, still probes, single and batch render, bundle, Lambda and Cloud Run rendering, benchmark, versions, upgrade, and GPU checks. Also use when diagnosing a build or render failure, or when looking for a capability the retired HyperFrames CLI used to own.
---

# Remotion CLI

The tool is `remotion`, from `@remotion/cli`. Every command runs through `npx remotion <command>`, and every one of them bundles the project first, so a type error or a bad import surfaces as a bundling failure rather than a render failure.

**`npx remotion --help` and `npx remotion <command> --help` are the authority on flags.** Flags move between releases; read the help output rather than trusting a list, including this one. What is below is the loop and the failure modes, not a flag reference.

## The loop

| Stage           | Command                                                       | Why                                                                |
| --------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| Scaffold        | `npx create-video@latest --blank`                             | writes a matched `package.json`, `remotion.config.ts`, `tsconfig`  |
| Type-check      | `npx tsc --noEmit`                                            | the cheapest gate; catches schema/prop drift before any render     |
| List            | `npx remotion compositions`                                   | confirm the `id` you are about to render actually exists           |
| Probe a frame   | `npx remotion still <id> out/probe.png --frame=<n>`            | seconds, not minutes; the workhorse of iteration                   |
| Review          | `npx remotion studio`                                         | hand it to the user; they scrub and edit props themselves          |
| Render          | `npx remotion render <id> out/video.mp4`                       | only after the user approves                                       |
| Ship remotely   | `npx remotion bundle` → `npx remotion lambda render <url> <id>` | distributed render; needs deployed AWS infrastructure              |

### Probe stills before you render

A full render of a 45-second 1080p composition costs minutes. A still costs seconds and answers most questions: is the text inside the frame, did the asset load, is the color right. Probe the midpoint of each scene, look at every image, and only then render.

```bash
npx remotion still launch out/s1.png --frame=45
npx remotion still launch out/s2.png --frame=180
```

Never report a composition as working on the strength of a passing bundle. Look at pixels.

### Studio is the review surface, not your debugger

`npx remotion studio` serves the project with a timeline, a props editor driven by the Zod schema, and frame-accurate scrubbing. Hand it to the user for approval. For your own verification prefer `still` probes: they are scriptable, and you can look at the output without asking the user to describe what they see.

### Passing props

`--props` takes a JSON string or a path to a JSON file, and overrides `defaultProps`:

```bash
npx remotion render launch out/video.mp4 --props='{"productName":"Acme"}'
```

A prop that fails the composition's Zod schema fails the render loudly. That is the point of declaring the schema, so keep it accurate.

### Batch rendering

There is no batch subcommand. Loop in the shell over ids or prop payloads:

```bash
for id in $(npx remotion compositions --quiet); do
  npx remotion render "$id" "out/$id.mp4"
done
```

For many renders of one composition over a data set, prefer `renderMedia()` from `@remotion/renderer` in a Node script: it bundles once instead of once per render, which dominates the wall clock.

## Render performance

- `--concurrency=<n>` sets parallel workers. The default is half the CPU cores capped at 8; the maximum is the core count, and asking for more is an error, not a clamp. On a memory-tight machine, lowering it fixes crashes that look like renderer bugs.
- `--jpeg` (over the default PNG frame format) is a large speedup when the composition has no transparency to preserve.
- `npx remotion benchmark` measures a real render, so use it to justify a concurrency or codec change instead of guessing.
- `npx remotion gpu` reports what the browser will actually accelerate. Worth checking before blaming a shader or a heavy filter for a slow render.

## Diagnosing failures

| Symptom                                                | Likely cause                                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Bundling fails                                         | A type error or a bad import. Run `npx tsc --noEmit` for the readable version of the same error.          |
| "No composition with id …"                             | The `id` in `Root.tsx` differs from the one you passed. `npx remotion compositions` settles it.           |
| Render hangs, then times out                           | A `delayRender()` with no matching `continueRender()`. Every delay handle must be released.               |
| Every frame looks like frame 0                         | A CSS animation/transition, or `requestAnimationFrame`. The renderer does not advance the browser clock.  |
| Animation strobes or flickers frame to frame           | Unseeded `Math.random()`. Use `random(seed)`.                                                             |
| Motion works while scrubbing forward, breaks on a jump | State-driven animation. Derive from `useCurrentFrame()` instead.                                          |
| Asset 404s only in a Lambda or bundled render          | A hardcoded path instead of `staticFile()`.                                                               |
| Versions error that makes no sense                     | Mismatched Remotion packages. `npx remotion versions` reports the disagreement.                           |
| Out-of-memory mid-render                               | Concurrency too high for the machine. Lower `--concurrency`.                                              |

Surface the actual error output when you report a failure. Do not paraphrase a stack trace.

## Where the retired HyperFrames CLI capabilities went

The old `hyperframes` CLI bundled authoring, media, and QA commands that Remotion's CLI does not have. Nothing below is a Remotion command, so do not try to run them:

| Retired command                       | Where the capability lives now                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| `init`                                | `npx create-video@latest --blank`, then `/hyperframes-core` → `references/project-structure.md` |
| `lint`, `check`, `layout`, `validate` | `npx tsc --noEmit` plus `still` probes. The `data-*` contract those gates enforced is gone.  |
| `snapshot`, `compare`, `grade-compare` | `npx remotion still` at chosen frames; diff the PNGs with your own tooling.                 |
| `preview`, `play`, `present`          | `npx remotion studio`                                                                        |
| `add`, `catalog`                      | `/hyperframes-registry`                                                                      |
| `capture`                             | `/product-launch-video` (site capture) and `/media-use`                                      |
| `tts`, `transcribe`, `remove-background` | `/media-use`                                                                                |
| `beats`, `keyframes`                  | `/hyperframes-creative` (beat planning), `/hyperframes-keyframes`                             |
| `cloud`, `publish`                    | `npx remotion bundle` + `remotion lambda` / `remotion cloudrun`, or your own hosting         |
| `skills`, `docs`, `upgrade`, `doctor` | these skills are vendored in this repo; `npx remotion upgrade` and `npx remotion versions`   |

If a workflow skill or reference file still instructs you to run `npx hyperframes <anything>`, that instruction is stale. Do the Remotion equivalent from the table above and say in your summary that you hit a stale pointer, so it can be fixed.
