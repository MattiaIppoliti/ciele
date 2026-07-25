# packages/db — `@agent-hub/db`

The data layer for `apps/web` only (`apps/admin` deliberately does not use it — see
`apps/admin/CLAUDE.md`).

## Commands

```bash
pnpm --filter @agent-hub/db test        # vitest run
pnpm --filter @agent-hub/db typecheck   # tsc --noEmit
```

## Shape

- `types.ts` — the `Db` interface and every domain type. **This is the seam.** Consumers program
  against it; nothing else in the package is public API.
- `supabase.ts` — the RLS-scoped implementation.
- `mock.ts` — in-memory demo implementation. The app runs on it when Supabase env is absent.
- `engine.ts` — the deterministic keyword router (`matchFlow`), the offline/no-model fallback.
  **Routing only** — action rendering lives solely in `apps/web/src/lib/runtime` (ADR-0003).
- `src/testing/` — Supabase-backed harnesses (pglite + a PostgREST shim), not shipped code.

## Adding to the `Db` interface

Both implementations must satisfy it. The contract suite in `db-contract.suite.ts` is run twice:

- `db-contract.test.ts` → against `mock`
- `src/testing/db-contract.supabase.test.ts` → against a pglite-backed Supabase shim

So a new method means: extend `types.ts`, implement in **both** `supabase.ts` and `mock.ts`, and
add the case to the shared suite — not to one of the two test files. A method that only passes
in mock is a bug that reaches production.

Narrow the facade rather than widening it where you can (ADR-0016).

## Gotchas

- pglite tests carry real Postgres semantics including RLS policies — a failure in
  `assistant-access-rls.test.ts` or `table-access.test.ts` means a tenancy leak, not a fixture
  problem.
- `mock.ts` ships demo data (`DEMO_ORG`, `DEMO_MEMBER`, teammates like `u-valeria`); the contract
  suite depends on those seeds existing.
