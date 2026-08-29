-- Give the Supabase service roles the password this deployment generated.
--
-- Runs once, during Postgres' first initialisation, mounted as a single file
-- into /docker-entrypoint-initdb.d/init-scripts/ (99- prefix, after the
-- image's own scripts) and NEVER over the whole directory: the image bakes
-- its init there (the postgres role, the auth/storage schemas and their
-- tables, the auth.uid()/auth.role() helpers every RLS policy calls), and
-- masking it boots a cluster with none of that.
--
-- A .sql file, not a .sh: the image's baked migrate.sh is what processes
-- init-scripts/, and it only executes *.sql (as -U postgres over the local
-- socket). A shell script placed here is silently skipped -- which left
-- GoTrue and storage-api crash-looping on "password authentication failed",
-- while the chain still reached 0040 against the image's baked (ancient)
-- storage.buckets shape before dying on the missing `public` column.
--
-- Same mechanism as the official Supabase self-host compose (volumes/db/
-- roles.sql): psql substitutes the container's POSTGRES_PASSWORD via \set.
-- The roles themselves are baked into the image; we only stamp this
-- deployment's password onto them.

\set pgpass `echo "$POSTGRES_PASSWORD"`

alter role authenticator with login password :'pgpass';
alter role supabase_auth_admin with login password :'pgpass';
alter role supabase_storage_admin with login password :'pgpass';

-- The applier and the app connect as postgres; its password is set out of
-- band on the hosted platform, so a self-host stamps it here too.
alter role postgres with login password :'pgpass';
