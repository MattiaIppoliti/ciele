# Database restore

What we can lose, and how to get back what we can. Written by the 2026-08-27
data audit, which found the numbers existed nowhere.

## The current objectives, stated honestly

The live project (`ciele-app`, eu-central-2) runs on the Supabase **Free
plan**:

- **Backups**: automatic daily snapshots, **7-day** retention.
- **RPO (max data loss): up to 24 hours.** Everything written between the last
  nightly snapshot and the incident is gone. There is no PITR on Free.
- **RTO**: a dashboard-driven snapshot restore, historically minutes to low
  hours. Unmeasured until a drill is run (see below).

If either number stops being acceptable — the day real tenant conversations
carry value someone would miss — the fix is the Pro plan plus the PITR add-on
(RPO drops to ~2 minutes), not a cleverer runbook.

## What a snapshot restore does NOT bring back

- Writes since the snapshot (RPO above).
- Storage objects are backed up separately from Postgres on Supabase's side;
  verify both restored, the `knowledge-originals` bucket especially, since
  Sources reference it.
- Nothing outside the project: Vercel env, GitHub, provider keys are elsewhere.

## Restore procedure

1. **Stop the writers first.** Pause Vercel deployments or flip the app to
   maintenance; disable `migrate-nightly.yml` in Actions. A restore under
   live writes re-loses whatever lands mid-restore.
2. Dashboard → Database → Backups → pick the snapshot → Restore. This
   replaces the whole database; there is no partial restore on Free.
3. **Re-verify the migration ledger.** The snapshot carries
   `private.applied_migrations` as of snapshot time. If migrations landed
   after it, re-run the applier (Actions → CI → `workflow_dispatch`, or
   `migrate-nightly.yml` manually): the filename ledger makes this exactly a
   catch-up, files already recorded are skipped, pending ones apply.
4. Spot-check the three storage buckets and one Source's original file.
5. Re-enable writers.

## Bad-migration recovery (the more likely incident)

A migration that applied but was wrong does NOT need a snapshot restore:
migrations here are fix-forward (see `supabase/CLAUDE.md`), so write the
correcting migration and let CI apply it. Restore only when data was
destroyed, not when schema is wrong.

## The drill (not yet performed)

Nobody has restored this project. Until someone has, the RTO above is a
guess. The drill: restore the latest snapshot **into a scratch Supabase
project** (never the live one), point a local `apps/web` at it, sign in, open
an Inbox conversation. Time it, write the number here.

- [ ] Drill performed on: ____ · measured RTO: ____ · by: ____

## Related

- `scripts/apply-migrations.sh`, the filename-ledger applier (step 3).
- `.github/workflows/migrations.yml`, proof the chain rebuilds an empty
  database, which is also the floor under "rebuild from scratch" recovery.
- `20260730170000_trace_retention.sql` + nightly cron, the only deliberate
  data deletion in the system.
