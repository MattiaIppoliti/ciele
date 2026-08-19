# syntax=docker/dockerfile:1
# One-shot migration runner for the self-host stack (#440).
#
# Runs the repo's own filename-ledger applier, the same script CI runs
# against the hosted deployment, so a self-host and the hosted project never
# diverge on how migrations are applied. Built from the repo root:
#
#   docker build -f deploy/migrate.Dockerfile -t ciele-migrate .

FROM postgres:15-alpine

# The applier is bash (set -euo pipefail, [[ ]]); the image ships ash only.
RUN apk add --no-cache bash

WORKDIR /repo
COPY scripts/apply-migrations.sh scripts/apply-migrations.sh
COPY supabase/migrations supabase/migrations
COPY supabase/migrations-baseline.txt supabase/migrations-baseline.txt
COPY supabase/seed.sql supabase/seed.sql
COPY deploy/migrate-entrypoint.sh /usr/local/bin/migrate-entrypoint.sh

RUN chmod +x scripts/apply-migrations.sh /usr/local/bin/migrate-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/migrate-entrypoint.sh"]
