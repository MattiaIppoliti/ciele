# The domain lives in `@agent-hub/core`, under the `Db` seam

## Status

Accepted. Complements [ADR-0016](0016-db-facade-narrowing.md), that ADR narrows the same file
*vertically*, this one cut it *horizontally*. Neither supersedes the other and ADR-0016's staged plan
is unaffected: it has fewer lines to move now, in a file that contains only operations.

## Context

`packages/db` was two modules wearing one name.

`packages/db/src/types.ts` was 2,424 lines: **1,720 of domain types** (~150 interfaces, `Flow`,
`Assistant`, `Concept`, `Publication`, `Organization`, the whole `Insights*` family) followed by
**703 lines of `export interface Db`** (170 method signatures). Alongside them sat ~1,150 lines of
pure domain logic that had no data-access concept in it at all:

| module | lines | imports |
|---|---|---|
| `okf.ts` | 225 | **zero** |
| `insights.ts` | 403 | types only, and it is the oracle the SQL aggregate is checked against |
| `engine.ts` | 174 | one type (the deterministic keyword router of ADR-0003) |
| `defaults.ts` · `publication.ts` · `recrawl.ts` · `message.ts` · `pricing.ts` · `id.ts` | ~340 | types only |

The consequence: **wanting the word `Flow` meant depending on a 17,600-line Supabase adapter.**
Measured, 92 of `apps/web`'s 170 `@agent-hub/db` imports were `import type`, over half the
dependency was the half with no I/O in it. And the fast unit tests for those pure modules shared a
vitest project with an in-process Postgres that takes ~25s to boot the real migration chain, so a
one-line change to the flow router ran a 26.7-second suite.

## Decision

Cut at the line where `interface Db` begins. The domain moves to **`@agent-hub/core`**; `@agent-hub/db`
depends on it and keeps only the seam.

- **`@agent-hub/core`**: `types.ts` (the ~150 domain types), plus `okf.ts`, `engine.ts`, `insights.ts`,
  `defaults.ts`, `publication.ts`, `recrawl.ts`, `message.ts`, `pricing.ts`, `id.ts`. Zero runtime
  dependencies. This is the package created in ADR-0018 for shared pure helpers; the domain is what it
  was always going to hold, and its identity is now "the domain and everything derivable from it"
  rather than "helpers".
- **`@agent-hub/db`**: `interface Db`, its two adapters (`supabase.ts`, `mock.ts`), the generic
  `table-access.ts` accessor, `improvements.ts` (it takes a `Db`, so it stayed), the contract suite and
  the pglite harness. Its `types.ts` is now 815 lines: 94 type imports from core and the interface.
- **No compatibility re-export.** `@agent-hub/db` does *not* re-export the domain, so the dependency
  arrow is visible at each call site; a convenience re-export would have made this bookkeeping rather
  than architecture. All 172 `@agent-hub/db` import statements (155 files) were rewritten: 165
  `@agent-hub/core` statements across 139 files now exist, and 78 `@agent-hub/db` statements across
  71 files remain, the ones that still want an *operation* (`Db`, `createDb`, `getMockDb`,
  `isSupabaseConfigured`, `raiseImprovement`, `DEMO_ORG`, `DEMO_MEMBER`).
- **The type-only cycle dissolved for free.** `types.ts` referenced `table-access.ts` at exactly one
  place, the `table<K extends DbTableName>()` method inside `Db`. The domain half never needed it.
- **`@agent-hub/core/testing`** publishes the Insights fixtures, so the pure oracle tests (core) and
  the SQL parity test (db) assert against the *same* fixtures. That shared spec is what makes the
  parity claim mean anything, and it is why the fixtures could not simply stay behind.

## Consequences

- **Import a type from `@agent-hub/core`, an operation from `@agent-hub/db`.** New rule at every call
  site, enforced by resolution: the domain is no longer reachable through the db barrel.
- **A domain-only change no longer boots Postgres.** The 90 tests over the domain and its derivations
  now run in a project with no pglite in it: **0.9s**, against **8.9s** for the db suite, which applies
  the real migration chain in-process (both measured back to back on an idle machine; absolute numbers
  move a lot under concurrent load, the structural point does not). Before the split those 90 tests
  lived in the db project, so a one-line change to the flow router paid the migration boot. Test count
  is conserved exactly, 327 before, 327 after, and turbo now caches the two independently.
- `insights.test.ts` split along the same seam it documents: the pure KPI functions and the oracle
  parity stay in core; the "does the adapter agree with the oracle" half became
  `packages/db/src/insights-adapter.test.ts`, next to the adapter it tests. The SQL half was already
  separate.
- The staff console can now use the domain vocabulary without adopting the `Db` facade, which is the
  precondition for closing its duplicated types (the next candidate in the architecture review).
- **ADR-0016's stages 3–4 are unaffected, with one wording knock-on**: its "a new table then costs
  one row-type, not three hand-written methods" now means one row-type *in `@agent-hub/core`*. That
  ADR was not amended; this bullet is the pointer.
- **The barrel is split two ways on purpose.** The vocabulary (`types`, `okf`) is `export *`; it has
  no internals. The derivations are curated, because they do: `computeInsightsOverview` composes seven
  helpers that were package-private inside `db` and would otherwise have become public API with
  nothing locking them. Three names the old db barrel exported (`hostOf`, `WEEK_DAYS`,
  `defaultTimeRange`) had no remaining consumer and were not carried over.
- **`pricing.ts` still duplicates the per-model rates in `@agent-hub/agent`'s `catalog.ts`.** Moving it
  next to the domain did not fix that; it made it visible. Left as-is deliberately, collapsing the two
  is a separate change with its own correctness question about which is authoritative.
