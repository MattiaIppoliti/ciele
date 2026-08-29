# Measuring the client bundle

How to get a number before changing code for bundle reasons, and the two tools that
*look* like the answer here but are not.

## What does not work

**`next build` output.** Next 16 dropped the per-route size columns. The route table lists
paths and render modes and nothing else. There is also no `app-build-manifest.json` under
Turbopack, so scripts written against that file find nothing.

**`@next/bundle-analyzer`.** It works by injecting a webpack plugin through `config.webpack`.
`next build` defaults to Turbopack in Next 16, which ignores a `webpack` config (and errors
when one is present without a matching `turbopack` config). Wired up and run, the analyzer
says so itself and exits without writing a report:

```
The Next Bundle Analyzer is not compatible with Turbopack builds, no report will be generated.
Consider trying the new Turbopack analyzer via `next experimental-analyze`.
```

Don't add it. It cost a dependency and two builds to confirm.

**`experimental.optimizePackageImports: ["lucide-react"]`.** Already redundant,
`lucide-react` is in Next's built-in default list (`next/dist/server/config.js`), alongside
`recharts`, `date-fns` and ~40 others. Adding it changes nothing. And the transform only
drops *unused* named imports, so it does nothing for a module that genuinely references
every icon it imports.

## What does work

### Absolute numbers: `pnpm measure:bundle`

```bash
pnpm --filter @agent-hub/web build
pnpm --filter @agent-hub/web measure:bundle
```

Reads the `<script>` tags out of each prerendered page under `.next/server/app/**.html` and
gzips the chunks they reference. That is the real first-load payload, and it is ground truth
because it is what Next actually told the browser to fetch.

Only statically prerendered routes show up, a dynamic route emits no build-time HTML. That
still covers the whole marketing surface and several admin pages.

### Ratios: `pnpm analyze` + `pnpm attribute`

```bash
pnpm --filter @agent-hub/web analyze          # next experimental-analyze -o
pnpm --filter @agent-hub/web attribute home   # or: security, assistants, pricing, ...
```

`next experimental-analyze` is the Turbopack-native analyzer. With `-o` it writes
`.next/diagnostics/analyze/`; without `-o` it serves an interactive UI on port 4000.
`scripts/attribute-bundle.mjs` reads its data and groups per-module bytes into buckets
(lucide, motion, react, next runtime, app source, …).

**Its `compressed_size` is each module gzipped in isolation, so the column does not sum to
the transferred size**, a route's parts add to noticeably more than it actually ships. Use
it to answer "which of these two is bigger", never "how many KB will I save".

### Proving a saving: A/B the build

The only trustworthy way to price a specific change. Stub the thing out, keeping the public
surface so the app still compiles, build, and diff `measure:bundle` against the baseline.
That is how the animated-icon barrel was priced at ~16–18 KB gzip per route: a stub of
`animated-icon.tsx` that dropped the lookup map and its ~150 imports moved `/home` from
323.6 KB gz to 307.8 KB gz, and nothing else.

## Where the weight actually is

Measured on `main` at 9f7a21df, for context on what is worth chasing:

| Route | raw | gzip |
|---|---|---|
| `/assistants` (admin) | 1312.4 KB | 402.6 KB |
| `/home` | 1071.8 KB | 323.6 KB |
| `/features/*` | 1035.1 KB | 310.5 KB |
| `/security`, `/policies/*` | 990.0 KB | 298.2 KB |
| `/login` | 655.3 KB | 195.0 KB |
| `_global-error` | 613.6 KB | 182.8 KB |

`_global-error` is close to the floor: ~183 KB gz before any of our own code. `/login` at
195 KB is that floor plus almost nothing. So a marketing route's ~300 KB is roughly
180 KB of framework and ~120 KB of everything we wrote and pulled in, and by
`attribute`'s ratios the largest single dependency in that second half is `motion`, not
icons. Chase individual components only after checking they are more than a rounding error
against that floor.

## Motion is deferred, not removed

`motion/react` is the largest single dependency in the half of a marketing route that is
ours, and the home page now pays for none of it up front: every use of it on `/home` is
behind a lazy boundary.

| Boundary | Loads when |
|---|---|
| `home/hero-rotating-word.tsx` | after hydration; the resting word is server-rendered |
| `home/nav-dropdown.tsx`, `nav-panel`'s mobile list | first pointer/focus in the nav, first tap of the menu |
| `home/feature-card.tsx` (tilt, spotlight, morphing dialog) | the features grid comes within 400px of view; `feature-card-face` is what SSR renders |
| `core/magnetic.tsx`, `motion/tilt-card.tsx`, `marketing/spotlight-card.tsx`'s glow | first pointer movement on a fine-pointer device (`lib/hooks/use-pointer-seen.ts`) |
| `home/home-section-rail.tsx` | after hydration, and only from `xl` up |

`SpotlightCard`'s scroll-in reveal is no longer JavaScript at all: it is
`.marketing-card-reveal` in `home.css`, a view-timeline animation that degrades to the
card already in place where view timelines are unsupported.

Measured with `measure:bundle`, before and after, on this tree:

| Route | before | after |
|---|---|---|
| `/home` | 999.3 KB raw / 309.9 KB gz | 824.2 KB raw / 252.9 KB gz |
| `/features/*` | 999.9 KB raw / 307.9 KB gz | 839.2 KB raw / 255.5 KB gz |
| `/pricing` | 981.9 KB raw / 307.3 KB gz | 963.1 KB raw / 300.5 KB gz |
| `/security` | 942.4 KB raw / 293.2 KB gz | 923.9 KB raw / 286.6 KB gz |

`/pricing` and `/security` barely move because they still ship motion for one component:
`BouncyAccordion` (the FAQ). It is the last holdout, and the only one whose static
fallback is not obviously free, the grouped corner radii and the open row are the
animation. Defer it only with a `<details>` face that matches those states.

The rule the boundaries follow: **what the server renders must be the animation's resting
state**, so the swap changes only whether the thing can move. A lazy boundary that renders
nothing until its chunk lands trades bytes for a blank frame, which is not the trade.
