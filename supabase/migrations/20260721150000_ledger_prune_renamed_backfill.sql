-- Ledger hygiene: the 0023 seed backfill file was renamed when its content
-- was neutralized (#432), but the live ledger (private.applied_migrations)
-- still holds a row for the old filename, which no repo file will ever match
-- again. Remove the orphan. Matched by pattern so the old name (which
-- contains a real institution's name) is not re-embedded here; the current
-- file is excluded explicitly.
--
-- Guarded: the ledger table exists only where scripts/apply-migrations.sh
-- runs (live/CI). Fresh environments that replay migrations directly (the
-- PGlite test harness, local setups) have no ledger — no-op there.
do $$
begin
  if to_regclass('private.applied_migrations') is not null then
    delete from private.applied_migrations
    where filename like '0023\_backfill\_seed\_%.sql' escape '\'
      and filename <> '0023_backfill_seed_demo.sql';
  end if;
end $$;
