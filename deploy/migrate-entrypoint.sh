#!/usr/bin/env bash
# Wait for the schemas other services install, then apply migrations (#440).
#
# Ciele's migrations reference `auth.users` and insert the three storage
# buckets into `storage.buckets`. Those schemas are created by GoTrue and
# storage-api when they first start, which races a migration container that
# only waits for Postgres to accept connections. So: wait for the schemas,
# then run the repo's filename-ledger applier, then optionally seed.
#
# Env:
#   SUPABASE_DB_URL     required — postgresql://… (read by the applier)
#   WAIT_FOR_SCHEMAS    comma-separated schema names to wait for
#   WAIT_TIMEOUT_SECS   how long to wait for each (default 180)
#   LOAD_DEMO_SEED      "1" to load supabase/seed.sql after migrating
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is not set}"
WAIT_TIMEOUT_SECS="${WAIT_TIMEOUT_SECS:-180}"

wait_for_schema() {
  local schema="$1"
  local waited=0
  until psql "$SUPABASE_DB_URL" -tAc \
    "select 1 from information_schema.schemata where schema_name = '$schema'" \
    2>/dev/null | grep -q 1; do
    if [ "$waited" -ge "$WAIT_TIMEOUT_SECS" ]; then
      echo "Error: schema '$schema' did not appear within ${WAIT_TIMEOUT_SECS}s." >&2
      echo "       The service that owns it (auth = GoTrue, storage = storage-api)" >&2
      echo "       probably failed to start — check \`docker compose logs $schema\`." >&2
      exit 1
    fi
    [ "$((waited % 15))" -eq 0 ] && echo "Waiting for the '$schema' schema…"
    sleep 3
    waited=$((waited + 3))
  done
  echo "Schema '$schema' is ready."
}

IFS=',' read -ra schemas <<<"${WAIT_FOR_SCHEMAS:-}"
for schema in "${schemas[@]}"; do
  [ -n "$schema" ] && wait_for_schema "$schema"
done

echo "Applying migrations…"
bash scripts/apply-migrations.sh

if [ "${LOAD_DEMO_SEED:-}" = "1" ]; then
  # Idempotent by construction: seed.sql upserts. Safe to re-run, but the
  # bootstrap only asks for it on a fresh install.
  echo "Loading the demo seed…"
  psql -v ON_ERROR_STOP=1 "$SUPABASE_DB_URL" -f supabase/seed.sql
fi

echo "Database is ready."
