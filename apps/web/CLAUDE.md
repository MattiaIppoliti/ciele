# apps/web — `@agent-hub/web`

The tenant-facing product (`platform.ciele.app`). Next.js 16 App Router, React 19, Tailwind v4,
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

Bundle size (Next 16 prints none, and `@next/bundle-analyzer` does not work under Turbopack —
see [`docs/runbooks/bundle-measurement.md`](../../docs/runbooks/bundle-measurement.md)):

```bash
pnpm --filter @agent-hub/web measure:bundle   # first-load gz per prerendered route (needs a build)
pnpm --filter @agent-hub/web analyze          # next experimental-analyze -o
pnpm --filter @agent-hub/web attribute home   # per-module buckets; ratios only, not absolute KB
```

Dev server: use the Browser pane (`preview_start` with `web`, or `web-demo` for the
Supabase-less mock build) — see `.claude/launch.json`. Never `pnpm dev` in a shell.

## Test conventions

- Vitest, `environment: "node"`, `include: ["src/**/*.test.ts"]` — **`.tsx` tests are not
  picked up**. Component behaviour is tested through the plain-TS module it delegates to.
- Tests live next to their subject (`engine.ts` → `engine.test.ts`). Suffixed variants split a
  large surface by concern (`ingest.security.test.ts`, `ingest.crawl.test.ts`).
- `@` resolves to `src/`.

## The chat runtime is a package, not a folder

The runtime lives in [`packages/agent`](../../packages/agent/CLAUDE.md) (`@agent-hub/agent`), with
three entry points: `@agent-hub/agent` (server), `@agent-hub/agent/client` (client-safe) and
`@agent-hub/agent/local-providers` (provider CLIs). Its `exports` map declares only those, so a deep
import into its internals does not resolve — no lint rule needed (ADR-0005). Adding a public
capability = export it from a barrel **and** update `packages/agent/src/interface.test.ts`
deliberately; that test locks the surface.

The runtime is framework-free, so this app hands it the two Next-specific facts it needs by calling
`registerRuntimeHost` in `src/instrumentation.ts`. Anything the runtime needs from Next goes through
a port there, never an import.

## Boundaries the linter enforces

These are ESLint errors, not style preferences (`eslint.config.mjs`):

- **No browser Supabase client.** `createBrowserClient` from `@supabase/ssr` is banned in
  `src/components/**` and `src/app/**`; session mutation goes through a Server Action or the
  cookie-scoped server client.

## Data access

Everything goes through the `Db` seam in `@agent-hub/db` — never a raw Supabase query in a page
or component. **Domain types come from `@agent-hub/core`, operations from `@agent-hub/db`**
(ADR-0019): the db barrel does not re-export the vocabulary. Every read is org-scoped by Postgres
RLS; with no Supabase env the app falls back to the in-memory mock db, which is how `web-demo` runs.

## Mutations

Server Actions live in `src/app/actions.ts`, `src/app/auth/actions.ts`, and route-local
`actions.ts` files. After a mutation, revalidate by **path**, not tag (ADR-0005).

## Gotchas

- `src/ee/` is enterprise-only and excluded from the public mirror. OSS code must not import it.
- `vitest.config.ts` caps `maxWorkers` and raises `testTimeout`: this suite and `packages/agent`'s
  are both ~56 files and turbo runs them concurrently, so an unbounded worker pool oversubscribes
  the CPU and trips the default timeout on tests that assert behaviour, not speed.
- `src/lib/local-connector-runtime.test.ts` spawns the real connector process over HTTP; its waits
  use one `CONNECTOR_DEADLINE_MS` safety net, not a latency assertion.
