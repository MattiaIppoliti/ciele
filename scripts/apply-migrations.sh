#!/usr/bin/env bash
# Apply pending supabase/migrations/*.sql to the database at SUPABASE_DB_URL.
#
# Why not `supabase db push`: the live project's migration history was written
# out-of-band (dashboard/MCP) with timestamp versions and names that don't
# match the local filename prefixes, which also contain duplicates (0017,
# 0034, 0037, 0038) that can't coexist in the CLI's version-keyed history.
# This script tracks applied migrations by FILENAME in a private ledger
# instead, matching how this repo's migrations have actually been applied.
#
# Ledger: private.applied_migrations (filename primary key). Files listed in
# supabase/migrations-baseline.txt are recorded without being executed (they
# predate the ledger); every other file runs in C-locale filename order, each
# inside its own transaction that also records it, so a failed migration
# leaves no ledger row and the next run retries it. An advisory transaction
# lock plus a re-check inside the transaction make concurrent runs safe.
set -euo pipefail

# Run from the repo root (the script lives in <root>/scripts/).
cd "$(cd "$(dirname "$0")/.." && pwd)"

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is not set (postgresql://... connection string)}"

# Fail early with a clear message rather than letting psql fall back to a local
# socket and die with a cryptic "connection to server on socket ... failed".
if [[ "$SUPABASE_DB_URL" != postgresql://* && "$SUPABASE_DB_URL" != postgres://* ]]; then
  echo "Error: SUPABASE_DB_URL must be a postgresql:// connection string (got: '${SUPABASE_DB_URL%%:*}...')." >&2
  echo "       Copy the 'Session pooler' string from the Supabase dashboard's Connect dialog." >&2
  exit 1
fi
# The direct host (db.<ref>.supabase.co) is IPv6-only; IPv4-only CI runners
# (e.g. GitHub Actions) can't reach it. Use the IPv4 session pooler instead.
if [[ "$SUPABASE_DB_URL" == *@db.*.supabase.co:* ]]; then
  echo "Error: SUPABASE_DB_URL points at the direct database host (db.*.supabase.co)," >&2
  echo "       which is IPv6-only and unreachable from IPv4-only CI runners." >&2
  echo "       Use the session pooler host instead: postgres.<ref>@aws-<n>-<region>.pooler.supabase.com:5432" >&2
  exit 1
fi

MIGRATIONS_DIR="supabase/migrations"
# Enterprise chain (#442): applied after the OSS chain so enterprise tables
# can reference OSS ones, never the reverse. Absent in the public mirror
# (ee/ is excluded), so an OSS checkout applies only the OSS chain.
EE_MIGRATIONS_DIR="ee/migrations"
BASELINE_FILE="supabase/migrations-baseline.txt"
# Arbitrary fixed key serializing concurrent appliers via advisory lock.
LOCK_KEY=913546

PSQL=(psql "$SUPABASE_DB_URL" --no-psqlrc --set ON_ERROR_STOP=1 --quiet)

"${PSQL[@]}" <<'SQL'
create schema if not exists private;
create table if not exists private.applied_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);
SQL

# Record baseline files as applied without executing them.
if [[ -f "$BASELINE_FILE" ]]; then
  grep -v '^\s*#' "$BASELINE_FILE" | grep -v '^\s*$' | while read -r name; do
    "${PSQL[@]}" -c "insert into private.applied_migrations (filename) values ('${name}') on conflict do nothing;"
  done
fi

applied=$("${PSQL[@]}" -At -c "select filename from private.applied_migrations;")

pending=0
apply_dir() {
  local dir="$1"
  while IFS= read -r file; do
    name=$(basename "$file")
    if grep -qxF "$name" <<<"$applied"; then
      continue
    fi
    pending=$((pending + 1))
    echo "Applying ${name}..."
    "${PSQL[@]}" <<SQL
begin;
select pg_advisory_xact_lock(${LOCK_KEY}) as _lock \gset
select exists(
  select 1 from private.applied_migrations where filename = '${name}'
) as already_applied \gset
\if :already_applied
  \echo '  already applied by a concurrent run, skipping'
  rollback;
\else
  \i ${file}
  insert into private.applied_migrations (filename) values ('${name}');
  commit;
\endif
SQL
  done < <(LC_ALL=C ls "$dir"/*.sql | LC_ALL=C sort)
}

apply_dir "$MIGRATIONS_DIR"
# The EE chain runs strictly after the full OSS chain, whatever the filename
# prefixes say, the two chains are ordered by phase, not interleaved by name.
if compgen -G "$EE_MIGRATIONS_DIR/*.sql" > /dev/null; then
  apply_dir "$EE_MIGRATIONS_DIR"
fi

if [[ $pending -eq 0 ]]; then
  echo "No pending migrations."
else
  echo "Done: ${pending} migration(s) processed."
fi
