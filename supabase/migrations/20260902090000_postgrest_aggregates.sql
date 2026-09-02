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
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'alter role authenticator set pgrst.db_aggregates_enabled = ''true''';
    perform pg_notify('pgrst', 'reload config');
  end if;
end
$$;
