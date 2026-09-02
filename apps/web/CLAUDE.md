# apps/web, `@agent-hub/web`

The tenant-facing product (`ciele.app`). Next.js 16 App Router, React 19, Tailwind v4,
shadcn/ui on Base UI. Admin console under `src/app/(admin)/`, widget runtime under
`src/app/widget/` + `src/app/api/`.

## Commands

Run from the repo root (turbo) or from here (direct):

```bash
pnpm --filter @agent-hub/web test        # vitest run
pnpm --filter @agent-hub/web typecheck   # tsc --noEmit
pnpm --filter @agent-hub/web lint        # eslint
```

Single test file: `pnpm --filter @agent-hub/web exec vitest run src/lib/escalation.test.ts`.

Bundle size (Next 16 prints none, and `@next/bundle-analyzer` does not work under Turbopack,
see [`docs/runbooks/bundle-measurement.md`](../../docs/runbooks/bundle-measurement.md)):

```bash
pnpm --filter @agent-hub/web measure:bundle   # first-load gz per prerendered route (needs a build)
pnpm --filter @agent-hub/web analyze          # next experimental-analyze -o
pnpm --filter @agent-hub/web attribute home   # per-module buckets; ratios only, not absolute KB
```

Admin performance ([`docs/runbooks/admin-performance.md`](../../docs/runbooks/admin-performance.md)).
The bundle budgets run inside `build`, so they gate CI; the two probes are manual and run
either locally in mock mode or against staging with a Member cookie:

```bash
pnpm --filter @agent-hub/web exec playwright-core install chromium   # once, for the browser probe
pnpm --filter @agent-hub/web check:admin-bundle        # route-increment gzip budgets (needs a build)
pnpm --filter @agent-hub/web check:admin-perf          # mock-mode build + both probes, 20 samples each
ADMIN_PERF_BASE_URL=… ADMIN_PERF_COOKIE=… pnpm --filter @agent-hub/web check:admin-latency
ADMIN_PERF_BASE_URL=… ADMIN_PERF_COOKIE=… pnpm --filter @agent-hub/web check:admin-interactions
```

Dev server: use the Browser pane (`preview_start` with `web`, or `web-demo` for the
Supabase-less mock build), see `.claude/launch.json`. Never `pnpm dev` in a shell.

## Test conventions

- Vitest, `environment: "node"`, `include: ["src/**/*.test.ts"]`, **`.tsx` tests are not
  picked up**. Component behaviour is tested through the plain-TS module it delegates to.
- Tests live next to their subject (`engine.ts` → `engine.test.ts`). Suffixed variants split a
  large surface by concern (`ingest.security.test.ts`, `ingest.crawl.test.ts`).
- `pnpm --filter @agent-hub/web test` is `vitest run` **minus** `**/*.security.test.ts`; those run
  under `test:security`, which `pnpm verify` and CI run as their own turbo task, so a red security
  suite is a red job of its own rather than one line in a long `test` log. Run both when a change
  touches an origin, egress or auth rule.
- `@` resolves to `src/`.

## The chat runtime is a package, not a folder

The runtime lives in [`packages/agent`](../../packages/agent/CLAUDE.md) (`@agent-hub/agent`), with
three entry points: `@agent-hub/agent` (server), `@agent-hub/agent/client` (client-safe) and
`@agent-hub/agent/local-providers` (provider CLIs). Its `exports` map declares only those, so a deep
import into its internals does not resolve, no lint rule needed (ADR-0005). Adding a public
capability = export it from a barrel **and** update `packages/agent/src/interface.test.ts`
deliberately; that test locks the surface.

The runtime is framework-free, so this app hands it the two Next-specific facts it needs by calling
`registerRuntimeHost` in `src/instrumentation.ts`. Anything the runtime needs from Next goes through
a port there, never an import.

## The Developer Panel

Per-page CLI/cURL/MCP snippets (#754/#755). Three conventions decide whether it stays honest:

- **One list.** `EndpointSpec` in `src/lib/api-v1/openapi.ts` carries `domain`, `capability`, `cli`
  and `mcp` beside the fields the OpenAPI document already read (the document builder ignores the new
  four). The MCP *tool name* lives on the domain in `src/lib/developer-panel/domains.ts`, because the
  16 coarse tools map onto the 19 domains many-to-one; only the `action` is per-endpoint. Per-domain
  copy (titles, agent prompts, docs links) lives there too, so `buildOpenApiDocument` never carries
  UI strings.
- **Pages declare, they never derive.** `apiDomains` on the `shell/nav.ts` entries, and
  `SETTINGS_API_DOMAINS` in `settings/settings-nav.ts` for the Settings dialog's tab routes. No claim
  → no button, which is why `/insights` and SETUP Style show none. Ask
  `panelDomainsForPath(pathname)`, never `apiDomains` directly: claiming a domain and being able to
  present it are two facts, and asking them separately let them disagree.
- **Three drift tests, because the templates are prose about other packages.** `openapi.test.ts`
  derives each endpoint's real capability from the ops its route file references;
  `developer-panel/cli-fidelity.test.ts` reads `packages/cli` and `packages/mcp` **sources** and
  rejects a noun, verb, flag, action or argument that does not exist; `catalogue.test.ts` fails when a
  claimed domain has nothing to present. A wrong snippet is worse than no snippet, someone scripts
  against it. Adding a domain means filling all three or failing CI.

The panel is a client component; the registry imports `@ciele/ops`, so the catalogue is built
server-side and fetched from `/api/developer-panel` on open rather than imported. The one new seam is
the pure builder in `developer-panel/snippets.ts` (placeholder substitution, the absent-CLI case,
body shapes, the deployment's own origin), tested directly, since vitest ignores `.tsx`.

## Motion and press feedback

Four conventions, all of them things this app previously got wrong in enough places that the fix
had to be a shared seam rather than a sweep:

- **Springs in the console come from `src/lib/ease.ts`.** `src/lib/ease.test.ts` asserts the
  damping ratio of every token: nothing may ship overdamped (ζ > 1.1, which settles *slower* than
  critical damping and still never overshoots), and only `SPRING_THROW` may overshoot at all,
  because overshoot belongs to motion a gesture actually threw. Pass a release velocity with it
  (`{ ...SPRING_THROW, velocity }`) or the bounce is arbitrary.
  The rule covers `components/motion`, `components/shell`, `components/agents` and the admin
  surfaces. It deliberately does **not** cover `components/home`, `components/core` and
  `components/marketing`: those are one-off marketing flourishes whose feel is the point (the home
  cursor runs at `stiffness: 1500`, the magnetic hover at `26.7`), and folding them onto console
  tokens would flatten them into the product. Nothing enforces the split, so when you meet a bare
  literal, check which side of it you are on.
- **Every clickable thing gets a press state.** `<Button>` has one built in; anything else takes
  a utility from `globals.css`: `press` (surfaces, rows, cards), `press-control` (small controls),
  or `press-text` (links and text-only triggers, which dip in tone rather than scale, because
  scaling a run of text reflows it against its neighbours and reads as a wobble). Hover alone is
  not feedback: on touch, where the widget and the marketing site mostly run, it never fires.
  This applies to `(marketing)` as much as the console. The exception is the decorative console
  mock on the home page (`home/app-preview.tsx`, `home/preview-panes.tsx`): it is a drawing of a
  UI, and its 30-odd fake rows should not answer a press as though they were real.
- **Gesture maths is pure and tested.** `packages/ui/src/resize-geometry.ts` (grab offset,
  rubber-band), `components/motion/projection.ts` (momentum projection, snap choice) and
  `components/shell/sidebar-drag.ts` (arm-then-commit). A drag that reads `e.clientX` straight
  into a width is missing the grab offset and will jump by up to 6px on the first move.
- **Enter and exit take the same path.** A surface that slides in from an edge leaves toward it.
  Where the parent owns mounting and `AnimatePresence` does not fit, `components/motion/
  use-exit-transition.ts` holds the unmount open long enough for the exit to play.

Reduced motion substitutes, it does not delete: the sheet cross-fades instead of sliding, `press`
swaps its scale for an opacity change. The **animated icon set** (`ciele-animated-icons`, via
`components/ui/animated-icon`) is deliberately left running under `prefers-reduced-motion` — those
are small pointer-triggered glyph state changes, not vestibular motion, and several controls use
them to signal what they do. Do not add a blanket `* { animation: none }`.

## Every route has its own loading.tsx

**All 66 `page.tsx` segments have their own `loading.tsx`, and
`src/lib/loading-coverage.test.ts` fails if that stops being true.** Adding a
route means adding its boundary in the same change.

Without one the router holds the *previous* page on screen until the server
answers, so the click that started the navigation looks like it did nothing.
Nineteen of forty-five console segments were bare before this.

- **Own, not inherited.** The test rejects a page covered only by an ancestor.
  `(admin)/loading.tsx` would otherwise "cover" every new console route while
  showing a dashboard-shaped skeleton on a settings form.
- **Delete it with the route.** The same test catches an orphan. This already
  shipped once: an upstream change removed `(admin)/projects` and left its
  boundary behind, which broke `typecheck` on a generated route type.
- **Use the shared skeletons**, don't hand-draw one per route:
  `components/route-skeleton.tsx` (`list` / `grid` / `form` / `prose` / `hero`),
  `components/auth-skeleton.tsx` for the routes outside the admin shell, and
  `components/widget/widget-skeleton.tsx` for the embedded widget. A boundary is
  then a four-line file. `src/lib/route-skeleton.test.ts` server-renders all of
  them, because a skeleton that throws turns a slow navigation into an error page.

Routes whose shape is genuinely distinctive (Inbox's three panes, the assistant
editor) keep their own hand-written skeleton instead.

## Boundaries the linter enforces

These are ESLint errors, not style preferences (`eslint.config.mjs`):

- **No browser Supabase client.** `createBrowserClient` from `@supabase/ssr` is banned in
  `src/components/**` and `src/app/**`; session mutation goes through a Server Action or the
  cookie-scoped server client.

## Data access

Everything goes through the `Db` seam in `@agent-hub/db`, never a raw Supabase query in a page
or component. **Domain types come from `@agent-hub/core`, operations from `@agent-hub/db`**
(ADR-0019): the db barrel does not re-export the vocabulary. Every read is org-scoped by Postgres
RLS; with no Supabase env the app falls back to the in-memory mock db, which is how `web-demo` runs.

## Mutations

Server Actions live in `src/app/actions.ts`, `src/app/auth/actions.ts`, and route-local
`actions.ts` files. After a mutation, revalidate by **path**, not tag (ADR-0005), and do it
**synchronously inside the action**: only then does the response carry the refreshed tree back,
which is what lets client components drop `router.refresh()`. `after(() => revalidatePath(...))`
purges after the client stopped listening and leaves the shell stale. Declare what you touched
through `orgMutation`'s `entities` rather than hand-listing paths; the entity table in
`src/lib/org-mutation.ts` also decides which kinds expire the Insights cache, the one shared
admin cache (ADR-0005 amendment).

## Gotchas

- `src/ee/` is enterprise-only and excluded from the public mirror. OSS code must not import it.
- `vitest.config.ts` caps `maxWorkers` and raises `testTimeout`: this suite and `packages/agent`'s
  are both ~56 files and turbo runs them concurrently, so an unbounded worker pool oversubscribes
  the CPU and trips the default timeout on tests that assert behaviour, not speed.
- `src/lib/local-connector-runtime.test.ts` spawns the real connector process over HTTP; its waits
  use one `CONNECTOR_DEADLINE_MS` safety net, not a latency assertion.
- The connector is a **checked-in release artifact**, not built from source, so shipping a change to
  `public/connectors/*.mjs` is a coordinated bump: rename the artifact, its own `VERSION`,
  `CURRENT_CONNECTOR_VERSION`, `CONNECTOR_SHA256` (recompute, `shasum -a 256`), and the filename +
  version rows in `local-connector-installer.test.ts` / `local-connector-protocol.test.ts`. Miss the
  digest and `/api/local-connector/runtime` 503s; miss `connectorNeedsUpgrade` and every installed
  connector is told to upgrade to the version it already runs.
- The connector's relay poll is the app's most-invoked endpoint by an order of magnitude, an idle
  paired connector bills Vercel functions forever. It backs off 1→12s when no job is claimed, and
  the ceiling must stay under `DEVICE_FRESH_MS` (30s) in `local-inference-relay.ts` or a healthy
  connector reads as offline. Anything slow (the local-CLI probe) belongs off that path.
