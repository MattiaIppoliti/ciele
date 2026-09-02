# supabase/, schema & migrations

One Supabase project backs both apps. `migrations/` is applied in filename order; `seed.sql`
carries demo data.

## Local commands (repo root)

```bash
pnpm db:start    # supabase start
pnpm db:reset    # re-apply migrations + seed
pnpm db:status
pnpm db:stop
```

## How migrations actually reach production

**Not** `supabase db push`. Every push to `main` runs `scripts/apply-migrations.sh` (the CI
`migrate` job), which applies pending `supabase/migrations/*.sql` in filename order and tracks
them **by filename** in `private.applied_migrations`. The live project's history predates this
repo's numbering (mismatched versions, duplicate numeric prefixes), so the CLI's version-keyed
tracking cannot represent it.

Rules that follow from that:

- **New migrations use timestamp prefixes**: `YYYYMMDDHHMMSS_name.sql`. The old `00NN_` scheme is
  legacy, don't extend it.
- A migration lands in the **same PR** as the code that needs it, and must be **additive first**:
  the Vercel deploy of a merge goes live in minutes while the CI `migrate` job waits for `verify`,
  so the new code serves against the old schema for a window (longer if `verify` fails, until the
  nightly applier). Code must therefore tolerate the schema being one migration behind: add the
  column/table in one PR, require it in the next, and drop old shapes only after nothing deployed
  reads them (the expand-contract precedent is `20260730190000_migrate_custom_tools`).
- `migrations-baseline.txt` lists files that are recorded without being executed. Only ever add
  to it for a migration that was applied to the live project outside CI. It reconciles the live
  database and nothing else, so the applier records it only when that database already carries what
  those files built; on an empty one (fresh self-host, CI replay) the whole chain runs from the
  first file. `MIGRATIONS_BASELINE=record|skip` overrides the probe.
- Migrations are append-only once merged. Fix forward with a new file; never edit an applied one.
  One exception, and only this one: a file that **no database executes through the applier** (every
  file through `20260710220000_compost.sql` is in `migrations-baseline.txt`, recorded and never run)
  may be edited to make an empty-database replay correct, because no fix-forward file can reach a
  failure that happens mid-chain. Two precedents: 0018 gained an existence **guard** around its
  `join_demo_org` grants, and 0025–0028 became documented **no-ops**. Anything outside that baseline
  is append-only, full stop.

## What gates a migration on a PR

`.github/workflows/migrations.yml`, **not** the Supabase Preview check. That one skips on every PR:
the live project's CLI history diverged from these filenames and left the production branch
failing, so no preview branch is ever created. The gate starts the self-host stack's Postgres +
GoTrue + storage-api, applies the full OSS chain then the EE chain to an **empty** database with
this repo's own applier, loads `seed.sql`, and asserts one ledger row per migration file.

So the case to keep working is the one production never exercises: **your migration must apply to a
database built from the chain alone.** If it depends on something only the live project has, the
gate fails, and that is the gate working, not noise to route around.

## Advisor sweeps

The project's own Performance and Security advisors are the source of truth for this kind of work,
not inspection of the chain: run them (`get_advisors`, or the dashboard's Advisors page) after any
migration that adds tables or policies. Three findings recur and all three have a settled answer:

- **`auth_rls_initplan`**: always write `(select auth.uid())`, never a bare `auth.uid()`, in a policy.
  The bare call is re-evaluated per row scanned. The `private.*` helpers take a per-row column
  argument, so they cannot be hoisted and are expected to appear per-row.
- **`unindexed_foreign_keys`**: every FK column gets a covering index in the same migration that
  creates the FK. Postgres does not add one, and without it a parent `ON DELETE` scans the child.
- **`multiple_permissive_policies`**: do not write a `for all` write policy beside a read policy on
  the same table; that makes SELECT match two permissive policies. Split into
  insert/update/delete. Splitting an existing one is only safe if the write predicate **implies**
  the read predicate, which has to be checked against the function bodies, not assumed.

`unused_index` findings are **not** actionable here yet: the project has served almost no traffic,
so "unused" is an unearned statistic, and most of those indexes exist to back RLS predicates and FK
cascades. `20260827130000_advisor_rls_initplan_and_fk_indexes.sql` records the full reasoning,
including the four findings deliberately left alone.

## Gotchas

- Since `0018_private_schema_hardening`, the RLS helpers live in the `private` schema. Call
  `private.is_org_member(...)` / `private.has_org_role(...)`, **never** `public.*`.
- There is no `0021`, and `0017` once had a duplicate prefix: its enterprise twin now lives in
  `ee/migrations/`, keeping the legacy filename because the filename is the ledger key. Intentional
  history, don't "fix" it.
- **0025–0028 are no-ops, on purpose.** They were byte-identical duplicates of 0017–0020: those four
  were applied straight to the live project and captured as local files only later, while the
  backfill twins were being written for the same purpose. Both sets landed. On the live project
  neither copy ever ran (both are baseline), but on an empty database the twin ran second, after
  0018 had moved `is_org_member`/`has_org_role` into `private`, so 0025's `public.has_org_role(...)`
  resolved to nothing and the replay died. The files stay because the filename is the ledger key.
- Enterprise migrations live in `ee/migrations/`, a separate chain applied strictly **after** the
  full OSS chain by the same applier. EE tables may reference OSS ones, never the reverse.
- New tables need RLS policies in the same migration, **and a test that asks as `authenticated`**.
  The pglite contract tests connect as a superuser, so they run straight past every policy; see
  `packages/db/src/testing/channel-access.test.ts` for the switch that makes them real. An
  unasserted policy is where the operations layer looks like the tenancy line and PostgREST is the
  way around it.
- **PostgREST aggregates are off until a migration turns them on.** `select("*, table(id.count())")`
  is an aggregate, and PostgREST ships with `db-aggregates-enabled = false`; hosted Supabase keeps
  the default. The pglite contract shim accepts the syntax unconditionally, so a green
  `db-contract.supabase.test.ts` proves nothing about the live API. The setting is in-database:
  `20260902090000_postgrest_aggregates.sql` runs `alter role authenticator set
  pgrst.db_aggregates_enabled = 'true'` and notifies `pgrst`, guarded on the role existing so the
  chain still applies to the pglite harness, the one database in the chain's life that has no
  `authenticator` (the migrations gate and the self-host stack boot the `supabase/postgres`
  image, which ships the role, so the alter-role branch runs there). The self-host stack also
  sets `PGRST_DB_AGGREGATES_ENABLED` on the rest container, which PostgREST reads at start, and
  `deploy/compose.test.mjs` asserts it. Reach for a new aggregate only when you have checked
  both are still in place.
- A rule about *which column* changed cannot be a policy, which sees a row. That is a trigger; see
  `20260824120000_teammate_channels.sql` (the channel manage rule) and
  `20260823170000_teammate_routine_cap.sql` (a count over sibling rows).
