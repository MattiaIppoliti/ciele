#!/usr/bin/env bash
# Provision an external Postgres before the stack's services touch it (#811).
#
# The `provision` service in deploy/docker-compose.external-db.yml runs this
# on the migrate image, as the provider's admin login. It waits for the host,
# runs a preflight that turns the common refusals into one actionable line
# each, then applies deploy/external-db/provision.sql. GoTrue and storage-api
# depend on it completing, so nothing connects to a database this has not
# accepted.
#
# Env:
#   PROVISION_DB_URL           required, postgresql://admin:password@host:port/db?sslmode=…
#   PROVISION_SERVICE_PASSWORD required, the password the three service logins share
#   PROVISION_MODE             "provision" (default) or "preflight" (checks only)
#   PROVISION_TIMEOUT_SECS     how long to wait for the host (default 60)
set -euo pipefail

: "${PROVISION_DB_URL:?PROVISION_DB_URL is not set}"
: "${PROVISION_SERVICE_PASSWORD:?PROVISION_SERVICE_PASSWORD is not set}"
MODE="${PROVISION_MODE:-provision}"
TIMEOUT="${PROVISION_TIMEOUT_SECS:-60}"

fail() {
  echo "Error: $1" >&2
  [ -z "${2:-}" ] || echo "       $2" >&2
  exit 1
}

# The URL never leaves this process, but the hostname is worth echoing: the
# most common mistake is the wrong one.
host_of() {
  local rest="${1#*://}"
  rest="${rest#*@}"
  rest="${rest%%/*}"
  printf '%s' "${rest%%:*}"
}
host="$(host_of "$PROVISION_DB_URL")"

# --- refusals that need no connection -----------------------------------------

# Hosted Supabase first: its pooler host would otherwise match the generic
# pooler pattern and get the less useful message.
case "$host" in
  *.pooler.supabase.com|db.*.supabase.co)
    fail "'$host' is a hosted Supabase project." \
      "Its roles already exist with passwords you do not hold, and its own GoTrue/PostgREST/Storage own the auth and storage schemas. Point the app at that project instead of running these containers against it."
    ;;
  *-pooler.*|*.pooler.*|*pgbouncer*)
    fail "'$host' looks like a connection pooler." \
      "PostgREST and storage-api hold a LISTEN connection and GoTrue relies on the role's search_path; none of that survives transaction pooling. Use the direct endpoint (Neon: drop '-pooler' from the host)."
    ;;
esac

case "$PROVISION_DB_URL" in
  *sslmode=disable*) fail "sslmode=disable in the database URL." "Every managed provider offers TLS and most require it; use sslmode=require (or verify-full with the provider's CA)." ;;
esac

# --- wait for the host ---------------------------------------------------------

PSQL=(psql "$PROVISION_DB_URL" --no-psqlrc --set ON_ERROR_STOP=1 --quiet -At)
waited=0
until "${PSQL[@]}" -c "select 1" >/dev/null 2>&1; do
  if [ "$waited" -ge "$TIMEOUT" ]; then
    err=$("${PSQL[@]}" -c "select 1" 2>&1 || true)
    hint="Check the hostname, that this machine's IP is allowed (Azure/RDS/Cloud SQL firewalls), and that the admin password is right."
    case "$PROVISION_DB_URL" in
      *sslrootcert=*) hint="$hint With --db-ca, a certificate error here means the bundle does not sign this server: RDS needs the regional or global bundle, Cloud SQL its own server-ca.pem." ;;
    esac
    fail "cannot reach the database at '$host' after ${TIMEOUT}s." "psql said: ${err}. ${hint}"
  fi
  [ "$((waited % 15))" -eq 0 ] && echo "Waiting for the database at '$host'…"
  sleep 3
  waited=$((waited + 3))
done

# --- preflight -----------------------------------------------------------------

version_num=$("${PSQL[@]}" -c "select current_setting('server_version_num')::int")
version=$("${PSQL[@]}" -c "show server_version")
if [ "$version_num" -lt 160000 ]; then
  fail "Postgres $version is too old: Ciele's external-database mode needs 16 or newer." \
    "On 15 only a superuser may create a BYPASSRLS role, and managed providers give you none."
fi

can_createrole=$("${PSQL[@]}" -c "select rolcreaterole from pg_roles where rolname = current_user")
[ "$can_createrole" = "t" ] ||
  fail "the login in the URL cannot create roles." \
    "Use the admin user the provider created with the server (Azure admin login, RDS master user, Cloud SQL 'postgres', the Neon console role)."

can_create_public=$("${PSQL[@]}" -c "select has_schema_privilege(current_user, 'public', 'create')")
[ "$can_create_public" = "t" ] ||
  fail "the login in the URL cannot create objects in schema public of this database." \
    "Postgres 15+ gives the public schema to the database owner. Connect as the login that created the database, or run: alter database <db> owner to <login>."

for ext in vector pg_trgm; do
  available=$("${PSQL[@]}" -c "select count(*) from pg_available_extensions where name = '$ext'")
  [ "$available" = "1" ] ||
    fail "extension '$ext' is not available on this server." \
      "Azure Flexible Server: add vector,pg_trgm to the azure.extensions server parameter. Other providers ship both; check the Postgres major."
done

# The pool the default stack holds at peak: GoTrue 10 + PostgREST 5 + storage 5
# + the applier + two LISTEN connections.
max_conn=$("${PSQL[@]}" -c "select setting::int from pg_settings where name = 'max_connections'")
reserved=$("${PSQL[@]}" -c "select setting::int from pg_settings where name = 'superuser_reserved_connections'")
usable=$((max_conn - reserved))
if [ "$usable" -lt 25 ]; then
  fail "the server allows only $usable connections; the stack needs about 25 at peak." \
    "Pick a larger tier (Cloud SQL db-f1-micro allows 25 in total; db-g1-small allows 50)."
fi

echo "Preflight OK: Postgres $version at '$host', $usable connections, vector + pg_trgm available, admin can create roles."

if [ "$MODE" = "preflight" ]; then
  exit 0
fi

# --- provision -----------------------------------------------------------------

echo "Provisioning roles, schemas, helpers and extensions…"
psql "$PROVISION_DB_URL" --no-psqlrc --set ON_ERROR_STOP=1 \
  -v pgpass="$PROVISION_SERVICE_PASSWORD" \
  -f /repo/deploy/external-db/provision.sql
echo "External database is provisioned."
