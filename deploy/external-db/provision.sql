-- Provision an external (managed) Postgres for the self-host stack (#811).
--
-- Recreates what the supabase/postgres image bakes into a fresh cluster at
-- first init and that GoTrue, PostgREST, storage-api and this repo's migration
-- chain depend on, reduced to what Ciele uses. Runs as the provider's admin
-- login (Azure admin, RDS master, Cloud SQL/AlloyDB `postgres`, a Neon console
-- role): CREATEROLE + CREATEDB, no superuser. Run by
-- deploy/provision-entrypoint.sh, which passes:
--
--   -v pgpass=<the shared password for the three service logins>
--
-- Idempotent: every create is guarded, every grant is repeatable, so the
-- `provision` service may run on every `up`. Hard requirements fail loudly
-- with a message that says what to do; the one soft item logs a NOTICE.
--
-- Requirements this file enforces (the matrix behind them: the two research
-- assets on the bring-your-own Postgres map):
--   * Postgres 16 or newer. On 15 only a superuser may create a BYPASSRLS role.
--   * The admin may create a role WITH BYPASSRLS. `service_role` needs it: the
--     service key's reads bypass RLS by construction, and the RPC fast paths
--     `auth.role() = 'service_role'` assume the rows are visible.
--   * `vector` and `pg_trgm` can be created (Azure: allow them in
--     `azure.extensions` first; RDS: the master user creates `vector`).

\set ON_ERROR_STOP on
select current_user as applier \gset
select current_database() as dbname \gset
\echo provision: as :applier on database :dbname

-- psql interpolates :'var' only in top-level SQL, never inside quoted text,
-- dollar-quoting included. So the one value the DO blocks below need, the
-- service password, is parked in a session setting here (top level) and read
-- back with current_setting() inside them. packages/db's provisioner test
-- asserts no psql variable is left inside a $$ block.
select set_config('ciele.provision_service_password', :'pgpass', false);

-- ── 0. Hard requirements ──────────────────────────────────────────────────
do $$
declare
  v int := current_setting('server_version_num')::int;
begin
  if v < 160000 then
    raise exception using
      message = format('Postgres %s is too old for an external database: Ciele needs 16 or newer.', current_setting('server_version')),
      hint = 'On Postgres 15 only a superuser may create a BYPASSRLS role, and managed providers give you none. Create the server on 16+ (Azure Flexible Server documents this exact limit).';
  end if;
  if not exists (select 1 from pg_roles where rolname = current_user and rolcreaterole) then
    raise exception using
      message = format('role %I lacks CREATEROLE; provisioning needs the provider''s admin login.', current_user),
      hint = 'Use the admin user the provider created with the server (Azure admin login, RDS master user, Cloud SQL "postgres", the Neon console role).';
  end if;
  -- Postgres 15+ hands the public schema to pg_database_owner: the chain
  -- creates every table there as this role, so it must own the database (or
  -- hold CREATE on public some other way).
  if not has_schema_privilege(current_user, 'public', 'create') then
    raise exception using
      message = format('role %I cannot create objects in schema public of database %I.', current_user, current_database()),
      hint = 'Connect as the owner of the database (the login that created it), or grant it: alter database <db> owner to <login>.';
  end if;
end $$;

-- ── 1. Roles ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin inherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin inherit;
  end if;
  alter role anon          set statement_timeout = '3s';
  alter role authenticated set statement_timeout = '8s';
end $$;

-- The hinge. Postgres 16+: a superuser OR a role holding BYPASSRLS may create
-- one. Azure's admin (16+) and Neon's console role hold it; on RDS / Aurora /
-- Cloud SQL / AlloyDB the master user is expected to. If it fails here, the
-- stack must not start: an RLS-gated service key is a silently broken install.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role' and not rolbypassrls) then
    execute 'alter role service_role bypassrls';
  elsif not exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'create role service_role nologin inherit bypassrls';
  end if;
exception when insufficient_privilege then
  raise exception using
    message = format('cannot give role service_role BYPASSRLS as %I (%s).', current_user, sqlerrm),
    hint = 'Ciele needs a service role that bypasses row-level security. Use a Postgres 16+ server whose admin login holds BYPASSRLS (Azure Flexible Server 16+, Neon, RDS/Aurora and Cloud SQL/AlloyDB master users), or ask the provider to grant it.';
end $$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute format('create role authenticator login noinherit password %L', current_setting('ciele.provision_service_password'));
  else
    execute format('alter role authenticator with login noinherit password %L', current_setting('ciele.provision_service_password'));
  end if;
  grant anon, authenticated, service_role to authenticator;
  alter role authenticator set statement_timeout = '8s';
  alter role authenticator set lock_timeout = '8s';

  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute format('create role supabase_auth_admin login noinherit createrole noreplication password %L', current_setting('ciele.provision_service_password'));
  else
    execute format('alter role supabase_auth_admin with password %L', current_setting('ciele.provision_service_password'));
  end if;
  -- GoTrue creates its enum types unqualified and later alters auth.<type>;
  -- without the role default the second step fails.
  alter role supabase_auth_admin set search_path = 'auth';
  alter role supabase_auth_admin set idle_in_transaction_session_timeout = 60000;

  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
    execute format('create role supabase_storage_admin login noinherit createrole noreplication password %L', current_setting('ciele.provision_service_password'));
  else
    execute format('alter role supabase_storage_admin with password %L', current_setting('ciele.provision_service_password'));
  end if;
  alter role supabase_storage_admin set search_path = 'storage';
  -- storage-api does set_config('role', <jwt role>) per request.
  grant authenticator to supabase_storage_admin;

  -- GoTrue's 20240612123726 migration grants to a role literally named
  -- postgres, unguarded. NOLOGIN is enough; on providers whose admin IS
  -- `postgres` (Cloud SQL, RDS default) this branch never runs.
  if not exists (select 1 from pg_roles where rolname = 'postgres') then
    create role postgres nologin;
  end if;
end $$;

-- ── 1b. The applier's memberships ─────────────────────────────────────────
-- Before the schemas, not after: on Postgres 16+ the creator of a role holds
-- ADMIN OPTION on it but not SET, and `create schema ... authorization <role>`
-- and `alter function ... owner to <role>` both require being able to SET
-- ROLE to the new owner. The same membership is what the migration chain
-- needs later: `create policy` on storage.objects and the triggers on
-- auth.users want ownership or membership in the owner (the image gives
-- `postgres` both).
do $$
begin
  execute format('grant supabase_auth_admin, supabase_storage_admin, anon, authenticated, service_role to %I', current_user);
exception when others then
  raise exception using
    message = format('cannot grant the service roles to the applier %I (%s).', current_user, sqlerrm),
    hint = 'The migration chain creates policies on storage.objects and triggers on auth.users, which needs membership in their owner roles. Re-run as the login that created those roles.';
end $$;

-- ── 2. Database privileges, schemas, ownership ────────────────────────────
-- GoTrue never creates `auth`; storage-api creates `storage` if allowed, but
-- the owner must be the role that runs its migrations. Both need CREATE on
-- the database (the schema guard, and GoTrue's own bootstrap contract).
do $$
begin
  execute format('grant connect, create on database %I to supabase_auth_admin, supabase_storage_admin, authenticator', current_database());
end $$;

create schema if not exists auth authorization supabase_auth_admin;
create schema if not exists storage authorization supabase_storage_admin;
create schema if not exists extensions;

grant usage on schema auth       to anon, authenticated, service_role;
grant usage on schema storage    to anon, authenticated, service_role, authenticator;
grant usage on schema extensions to anon, authenticated, service_role, authenticator;
-- PostgREST >= 11: the authenticator itself needs USAGE on each exposed schema.
grant usage on schema public     to anon, authenticated, service_role, authenticator;

-- The image's default privileges are why the chain never grants table access
-- to the API roles. They are per creating role, so: for the applier (which is
-- this admin) in the two schemas the chain creates objects in.
alter default privileges for role :"applier" in schema public  grant all on tables    to anon, authenticated, service_role;
alter default privileges for role :"applier" in schema public  grant all on functions to anon, authenticated, service_role;
alter default privileges for role :"applier" in schema public  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role :"applier" in schema storage grant all on tables    to anon, authenticated, service_role;
alter default privileges for role :"applier" in schema storage grant all on functions to anon, authenticated, service_role;
alter default privileges for role :"applier" in schema storage grant all on sequences to anon, authenticated, service_role;

-- ── 3. auth.* helpers every RLS policy calls ──────────────────────────────
-- GoTrue's own migrations `create or replace` these, so they must be owned by
-- its role or that step fails. Bodies mirror the image.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
create or replace function auth.email() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
alter function auth.uid()   owner to supabase_auth_admin;
alter function auth.role()  owner to supabase_auth_admin;
alter function auth.email() owner to supabase_auth_admin;
alter function auth.jwt()   owner to supabase_auth_admin;
grant execute on function auth.uid(), auth.role(), auth.email(), auth.jwt() to anon, authenticated, service_role;

-- ── 4. Extensions the chain needs ─────────────────────────────────────────
-- 0005 does `create extension vector` (public); 20260827160000 does
-- `pg_trgm with schema extensions`. Both `if not exists`, so creating them
-- here as the admin makes the chain's copies no-ops.
do $$
begin
  create extension if not exists vector;
exception when others then
  raise exception using
    message = format('cannot create extension vector (%s).', sqlerrm),
    hint = 'Azure Flexible Server: add vector,pg_trgm to the azure.extensions server parameter first. RDS/Aurora: connect as the master user. Cloud SQL/AlloyDB/Neon: use the admin role.';
end $$;
do $$
begin
  create extension if not exists pg_trgm with schema extensions;
exception when others then
  raise exception using
    message = format('cannot create extension pg_trgm in schema extensions (%s).', sqlerrm),
    hint = 'Azure Flexible Server: add pg_trgm to azure.extensions. Elsewhere pg_trgm is a trusted extension; check the connecting role has CREATE on the database.';
end $$;

-- ── 5. The one soft item ──────────────────────────────────────────────────
-- Our 20260902090000 migration repeats this and tolerates the same refusal;
-- PostgREST reads PGRST_DB_AGGREGATES_ENABLED from the compose regardless.
do $$
begin
  execute 'alter role authenticator set pgrst.db_aggregates_enabled = ''true''';
exception when insufficient_privilege then
  raise notice 'provision: pgrst.* cannot be set on the authenticator role here; PostgREST takes the option from its environment instead (already set in the compose).';
end $$;

-- ── 6. Report ─────────────────────────────────────────────────────────────
\echo provision: roles
select rolname, rolinherit as inherit, rolcanlogin as login, rolcreaterole as createrole, rolbypassrls as bypassrls
from pg_roles
where rolname in ('anon','authenticated','service_role','authenticator','supabase_auth_admin','supabase_storage_admin','postgres', :'applier')
order by rolname;
\echo provision: schemas
select nspname as schema, pg_get_userbyid(nspowner) as owner from pg_namespace where nspname in ('auth','storage','extensions','public') order by 1;
\echo provision: extensions
select extname, extversion, extnamespace::regnamespace as schema from pg_extension where extname in ('vector','pg_trgm') order by 1;
\echo provision: done
