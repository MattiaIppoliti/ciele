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

Single test file: `pnpm --filter @agent-hub/web exec vitest run src/lib/runtime/engine.test.ts`.

Dev server: use the Browser pane (`preview_start` with `web`, or `web-demo` for the
Supabase-less mock build) — see `.claude/launch.json`. Never `pnpm dev` in a shell.

## Test conventions

- Vitest, `environment: "node"`, `include: ["src/**/*.test.ts"]` — **`.tsx` tests are not
  picked up**. Component behaviour is tested through the plain-TS module it delegates to.
- Tests live next to their subject (`engine.ts` → `engine.test.ts`). Suffixed variants split a
  large surface by concern (`ingest.security.test.ts`, `ingest.crawl.test.ts`).
- `@` resolves to `src/`.

## Boundaries the linter enforces

These are ESLint errors, not style preferences (`eslint.config.mjs`):

- **Runtime is a deep module** (ADR-0005): import it only via `@/lib/runtime` (server) or
  `@/lib/runtime/client` (client). Deep imports into `@/lib/runtime/*` are rejected. Adding a
  public capability = export it from the barrel **and** update `src/lib/runtime/interface.test.ts`
  deliberately — that test locks the surface.
- **No browser Supabase client.** `createBrowserClient` from `@supabase/ssr` is banned in
  `src/components/**` and `src/app/**`; session mutation goes through a Server Action or the
  cookie-scoped server client.

## Data access

Everything goes through the `Db` seam in `@agent-hub/db` — never a raw Supabase query in a page
or component. Every read is org-scoped by Postgres RLS; with no Supabase env the app falls back
to the in-memory mock db, which is how `web-demo` runs.

## Mutations

Server Actions live in `src/app/actions.ts`, `src/app/auth/actions.ts`, and route-local
`actions.ts` files. After a mutation, revalidate by **path**, not tag (ADR-0005).

## Gotchas

- `src/ee/` is enterprise-only and excluded from the public mirror. OSS code must not import it.
- Runtime files ending `.security.test.ts` / `egress.security.test.ts` assert egress and
  SSRF guards — treat a failure there as a security regression, not a flaky test.
