-- Enable PostgREST aggregate functions for the Data API.
--
-- `packages/db/src/supabase.ts` reads the Improvements board with an embedded
-- count, `improvement_messages(id.count())`, so a lane of 100 rows is one
-- request instead of 100 link arrays. PostgREST ships with
-- `db-aggregates-enabled = false` and hosted Supabase keeps that default, so
-- without this setting the request fails with HTTP 400 on a real project while
-- the pglite contract shim (which accepts the syntax unconditionally) stays
-- green. In-database configuration is the documented way to turn it on for a
-- hosted project: PostgREST reads `pgrst.*` settings from its connection role
-- and re-reads them on `NOTIFY pgrst, 'reload config'`.
--
-- Guarded on the role: the pglite harness applies the chain to a database
-- that has no `authenticator` role. The migrations gate and the self-host
-- stack run the supabase/postgres image, which ships the role, so the branch
-- runs there as well; the self-host stack additionally sets
-- PGRST_DB_AGGREGATES_ENABLED on the rest container (see
-- deploy/docker-compose.yml). Re-running it is a no-op.
--
-- Guarded on privilege too (#810, bring-your-own Postgres). `pgrst.*` is a
-- placeholder GUC, and stock Postgres lets only a superuser, or a role granted
-- SET on that parameter, write one onto a role. The image allows it through
-- supautils; a managed Postgres (Azure, RDS, Cloud SQL, Neon) has neither, so
-- the statement is refused there and, unguarded, stopped the whole chain at
-- this file. The compose passes the same option to PostgREST as an environment
-- variable, so on refusal the right outcome is a NOTICE and a completed
-- migration, not a dead install. (Edited after it was applied to the hosted
-- project: the ledger row is already recorded there, so this file only ever
-- runs again on an empty database, which is exactly where the guard matters.
-- Same reasoning as the baseline-file exception in supabase/CLAUDE.md.)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    begin
      execute 'alter role authenticator set pgrst.db_aggregates_enabled = ''true''';
      perform pg_notify('pgrst', 'reload config');
    exception when insufficient_privilege then
      raise notice 'postgrest_aggregates: cannot set pgrst.db_aggregates_enabled on role authenticator here (%). PostgREST reads PGRST_DB_AGGREGATES_ENABLED from its environment instead; the self-host compose sets it.', sqlerrm;
    end;
  end if;
end
$$;
