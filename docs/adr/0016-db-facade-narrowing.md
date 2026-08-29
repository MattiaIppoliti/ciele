# Narrow the Db facade: behavioural interface + generic table access

## Status

Accepted: **stages 1–2 complete; stage 3 proceeds by domain tranche; stage 4
applies to every admitted table** (see PRD #279 / arch candidate #3).

- Stage 1: the additive accessor seam (`Db.table(name)`,
  `packages/db/src/table-access.ts`), both adapters implement it, the
  contract suite pins its semantics, `skills` is the first mapped table.
- Stage 2: `describeDbContract("supabase (pglite)")` runs the REAL
  `createSupabaseDb` over the REAL migrations in in-process PGlite
  (`packages/db/src/testing/supabase-contract-harness.ts` +
  `postgrest-shim.ts`). The full-schema question below is resolved: it loads.

- Stage 3, first batch: **skills**. `listSkills`/`createSkill`/`updateSkill`
  migrated onto `table("skills")` and deleted from `Db` + both adapters;
  `deleteSkill` keeps its named method for its `assistant_skills` cascade
  (the mock detaches by hand where Postgres cascades, exactly the case the
  staged plan carves out). The org-pinned wrapper's `table()` branch is now
  generic over a `PINNED_TABLES` allow-list, so later batches extend a set
  instead of duplicating the pinning.
- Later Stage 3 batches moved Entities, AI Teammates, Projects, Routines,
  Channels, local connector rows, and the mechanical half of Assistant Goals.
  Goal creation stays named because it enforces the per-Assistant cap; its
  final insert uses `table("assistantGoals")`.
- Stage 4 is complete for each admitted table: named CRUD is absent from that
  table before the next tranche is admitted. Intentional behavioral exceptions
  are documented beside the interface. The wider stage-3 migration remains
  deliberately incremental, as this ADR requires; this status must not imply
  that every mechanical domain has already been admitted.

## Context

At the time of the decision, `packages/db/src/types.ts` declared **144
methods**, each implemented three times: the interface, the RLS-scoped
Supabase adapter, and the in-memory mock. The product has grown substantially
since then; method count alone is no longer the migration metric because new
behavioural seams are expected to remain named.

Measured split of the 144 methods:

- **~19 behavioural methods** carry real, drift-prone semantics and earn the
  seam. They must stay first-class and contract-pinned:
  - worker leases / atomic claims: `claimBackgroundJobs`, `claimDueExportJobs`,
    `claimProcessingCrawlSource(s)`, `claimDueRecrawlSources`,
    `renewProcessingCrawlSourceClaim`, `releaseProcessingCrawlSourceClaim`,
    `claimDueAssistantGoals`, `claimUnverifiedAnswers`,
    `releaseAnswerVerifierClaim`, `claimDueCompostAssistants`
    (`SELECT … FOR UPDATE SKIP LOCKED` in SQL);
  - aggregation / search: `getInsightsOverview`, `matchChunks`;
  - dedup / atomic writes: `raiseAlert` (dedup-by-sourceKey upsert),
    `deleteConceptsByIds` (idempotent atomic concept replacement);
  - sealed-credential writes: `setTicketingIntegration`, provider-connection
    create paths.
- **~125 methods** are one-per-table CRUD passthroughs (`list*/get*/create*/
  update*/delete*`) whose implementation is about as complex as their signature
  and exists only to be mirrored in the mock.

The seam itself is settled (two real adapters; the mock powers fast tests,
ADR-0002). Only its **width** is the friction. The shared contract harness,
`describeDbContract(adapter, makeCtx)` (`db-contract.test.ts`), is written to run
over multiple adapters but is instantiated for the **mock only**, so mock↔
Supabase drift is asserted for none of the surface today.

## Decision

1. Keep the ~19 behavioural methods verbatim on `Db`; they remain the legible,
   contract-pinned core.
2. Introduce a **generic, typed table-access seam** for the plain CRUD, a small
   set of operations (`list`/`get`/`insert`/`update`/`delete` by table), typed
   against the existing row types, and migrate the ~125 named passthroughs onto
   it incrementally. A new table then costs one row-type, not three
   hand-written methods.
3. Wire `describeDbContract("supabase", …)` against an in-process **PGlite**
   context (the pattern proven by the Insights parity harness, PRD #270), so the
   two adapters are finally checked against one spec.

## Staged migration (each stage green + mergeable on its own)

1. **Additive accessor**: add the generic table-access methods to `Db` + both
   adapters + contract cases. No caller changes; nothing removed.
2. **Supabase contract**: stand up the PGlite-backed contract context for the
   table subset the spec exercises; run `describeDbContract` over both adapters.
3. **Call-site migration**: move callers off named passthroughs onto the
   generic accessor, a section at a time, deleting each passthrough once unused.
   Passthroughs whose deletes carry link cleanup the database does via `ON
   DELETE CASCADE` but the mock does by hand (e.g. `deleteSkill` detaching
   `assistant_skills`) either keep their named method or grow a per-table
   cascade hook in the spec before migrating.
4. **Cleanup**: remove named CRUD for every admitted table. Intentional
   behavioural exceptions remain documented beside the interface (for
   example `deleteSkill`'s attachment cascade and `createAssistantGoal`'s cap).
   Contract deletion assertions prevent removed passthroughs from returning.
   A remaining named method is not a backlog item by default: its domain must
   first prove that row mapping and writes satisfy the mechanical-table rule.

## Risks / why this is a draft

- **Blast radius**: stage 3 touches call sites across `apps/web`; it must be
  reviewed and sequenced, not auto-merged.
- **PGlite full-schema load**, RESOLVED by stage 2: the whole migration set
  applies to PGlite. pgvector comes from `@electric-sql/pglite-pgvector`;
  `auth` (users + uid()/role()/jwt() reading a session GUC), `storage`
  (buckets/objects), and the anon/authenticated/service_role roles are small
  preamble stubs. Four migrations are skipped as fresh-database duplicates of
  their backfill twins (0018/0025/0027/0028, see the harness's
  `FRESH_DB_SKIP`). Known limit: PGlite runs as table owner, so RLS policies
  are loaded but not enforced, the contract pins interface semantics, not
  tenant isolation.
- **Type ergonomics**: the generic accessor must stay type-safe per table
  without regressing the call-site experience; design-it-twice before locking
  the interface.

## Alternatives considered

- **Leave as-is**: the triple-write tax and the untested Supabase adapter
  persist.
- **Rip out all 125 in one PR**: too large to review or revert safely.
- **Only wire the Supabase contract (test-only)**: valuable and lower-risk, but
  blocked on the PGlite full-schema question above; tracked as stage 2.

## Consequences

- `Db` becomes a small behavioural interface + one generic accessor; adding a
  table stops meaning three edits.
- mock↔Supabase parity becomes a real, enforced check.
- The behavioural semantics (leases, insights, dedup) stay explicit and pinned.
