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
- A migration lands in the **same PR** as the code that needs it.
- `migrations-baseline.txt` lists files that are recorded without being executed. Only ever add
  to it for a migration that was applied to the live project outside CI.
- Migrations are append-only once merged. Fix forward with a new file; never edit an applied one.

## Gotchas

- Since `0018_private_schema_hardening`, the RLS helpers live in the `private` schema. Call
  `private.is_org_member(...)` / `private.has_org_role(...)`, **never** `public.*`.
- There is no `0021`, and `0017` once had a duplicate prefix: its enterprise twin now lives in
  `ee/migrations/`, keeping the legacy filename because the filename is the ledger key. Intentional
  history, don't "fix" it.
- Enterprise migrations live in `ee/migrations/`, a separate chain applied strictly **after** the
  full OSS chain by the same applier. EE tables may reference OSS ones, never the reverse.
- New tables need RLS policies in the same migration. `packages/db`'s pglite contract tests
  exercise them, an RLS gap shows up there, not in review.
