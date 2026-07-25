#!/bin/sh
# Call one Ciele cron route with the shared secret and log the outcome.
#
# Every route is guarded by CRON_SECRET as a bearer token (lib/cron-auth.ts)
# and refuses to run when the secret is unset — so a misconfigured scheduler
# fails loudly instead of silently skipping maintenance.
set -eu

path="$1"
url="${APP_URL:-http://app:3000}${path}"

: "${CRON_SECRET:?CRON_SECRET is not set — the app will reject every job}"

status=$(curl --silent --show-error --max-time 600 \
  --output /tmp/cron-body --write-out '%{http_code}' \
  --header "Authorization: Bearer ${CRON_SECRET}" \
  "$url") || {
  echo "[cron] $path FAILED to connect"
  exit 1
}

body=$(head -c 500 /tmp/cron-body)
if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
  echo "[cron] $path ok ($status) $body"
else
  echo "[cron] $path FAILED ($status) $body"
  exit 1
fi
