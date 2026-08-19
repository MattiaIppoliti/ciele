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
