# packages/db, `@agent-hub/db`

The **data-access seam, and only that** (ADR-0019). Every noun this package traffics in is a domain
type from [`@agent-hub/core`](../core/CLAUDE.md), which it depends on; what lives here are the
*operations*.

> **Import a type from `@agent-hub/core`, an operation from here.** This barrel does not re-export the
> domain, on purpose, the dependency arrow should be visible at every call site.

Used by `apps/web` and `@agent-hub/agent`. The enterprise staff console deliberately does not, see
its own CLAUDE.md.

## Commands

```bash
pnpm --filter @agent-hub/db test        # vitest run
pnpm --filter @agent-hub/db typecheck   # tsc --noEmit
```

## Shape

- `types.ts`, the `Db` interface: **over 200** method signatures over types imported from
  `@agent-hub/core`. **This is the seam.** Consumers program against it; nothing else here is public.
  Deliberately not an exact number any more: it said 170 while the interface held 204, because an
  exact count is a number every PR invalidates and no PR updates. If you need the real one, count
  it; what the figure is here for is the size of the facade ADR-0016 wants narrowed.
- `supabase.ts`: the RLS-scoped implementation.
- `mock.ts`: in-memory demo implementation. The app runs on it when Supabase env is absent.
- `table-access.ts`: the generic typed table accessor (ADR-0016 stage 1) that the plain-CRUD
  passthroughs migrate onto.
- `improvements.ts`: `raiseImprovement`. It lives here rather than in the domain package because it
  takes a `Db`; that is the test for which side of the seam a function belongs on.
- `src/testing/`: Supabase-backed harnesses (pglite + a PostgREST shim), not shipped code.

The deterministic keyword router (`matchFlow`), the OKF derivations, the Insights oracle and the rest
of the pure domain logic moved to `@agent-hub/core`; they never needed a database (ADR-0019).

## Adding to the `Db` interface

Both implementations must satisfy it. The contract suite in `db-contract.suite.ts` is run twice:

- `db-contract.test.ts` → against `mock`
- `src/testing/db-contract.supabase.test.ts` → against a pglite-backed Supabase shim

So a new method means: extend `types.ts`, implement in **both** `supabase.ts` and `mock.ts`, and
add the case to the shared suite, not to one of the two test files. A method that only passes
in mock is a bug that reaches production.

Narrow the facade rather than widening it where you can (ADR-0016).

## Gotchas

- pglite tests carry real Postgres semantics, and a failure in `table-access.test.ts` means a
  tenancy leak, not a fixture problem. **RLS is the exception**: PGlite connects as a superuser, so
  policies are bypassed unless a test asks for them. `channel-access.test.ts` is the pattern, grant
  what Supabase grants out of band, then `set role authenticated` with the caller's id in the JWT
  claim. A policy no test switches role for is unasserted, however many pglite tests touch the table.
- `mock.ts` ships demo data (`DEMO_ORG`, `DEMO_MEMBER`, colleagues like `u-valeria`, not to be
  confused with an **AI Teammate**, which is an entity of its own); the contract
  suite depends on those seeds existing.
