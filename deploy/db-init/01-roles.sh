#!/bin/bash
# Give the Supabase service roles the password this deployment generated.
#
# Runs once, during Postgres' first initialisation (docker-entrypoint-initdb.d).
# The supabase/postgres image creates these roles, but with passwords the
# hosted platform sets out of band, so on a self-host GoTrue, PostgREST and
# storage-api cannot authenticate until we set them here. Roles are created
# if the image ever stops shipping them, so this stays correct either way.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	do \$\$
	declare
	  r text;
	begin
	  -- Login roles the services connect as.
	  foreach r in array array['authenticator', 'supabase_auth_admin', 'supabase_storage_admin']
	  loop
	    if not exists (select 1 from pg_roles where rolname = r) then
	      execute format('create role %I with login noinherit', r);
	    end if;
	    execute format('alter role %I with login password %L', r, '$POSTGRES_PASSWORD');
	  end loop;

	  -- Non-login roles PostgREST switches into per request.
	  foreach r in array array['anon', 'authenticated', 'service_role']
	  loop
	    if not exists (select 1 from pg_roles where rolname = r) then
	      execute format('create role %I nologin noinherit', r);
	    end if;
	    execute format('grant %I to authenticator', r);
	  end loop;

	  -- Each service owns its own schema.
	  execute 'alter role supabase_auth_admin set search_path = auth';
	  execute 'alter role supabase_storage_admin set search_path = storage';
	  execute 'grant create on database ' || quote_ident(current_database()) ||
	          ' to supabase_auth_admin, supabase_storage_admin';
	end
	\$\$;
EOSQL
