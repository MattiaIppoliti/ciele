#!/bin/sh
# Make a *prebuilt* web image configurable at run time (#686).
#
# Next.js inlines every `NEXT_PUBLIC_*` reference at build time. Measured on
# this app: the two Supabase values land in ~114 server chunks under
# `.next/server` and in none of `.next/static` — the app has no browser
# Supabase client, so both are read server-side only. That is still build-time
# inlining, which means a published image built with one origin can never
# serve another, and the runtime `environment:` entries in the compose file
# are silently ignored for these two keys.
#
# A source build has no problem (it bakes in the values it was given), so this
# script must not change it: an image built without the sentinels below is
# untouched and boots exactly as before. The published image is built WITH
# them, and this rewrites them in place at container start.
#
# The rewrite happens once per container start, on the container's own writable
# layer. Changing a value therefore needs the container recreated, not
# restarted — which is what `docker compose up -d` does when env changes.
set -eu

# Written into the bundle by `docker build --build-arg NEXT_PUBLIC_...=<sentinel>`.
# Both are chosen to be well-formed for their type: the build prerenders static
# pages, and a malformed URL there would fail the build rather than wait for a
# request.
SENTINEL_URL="http://ciele-runtime-substitution.invalid"
SENTINEL_ANON_KEY="ciele-runtime-substitution-anon-key"

BUNDLE_DIR="${CIELE_BUNDLE_DIR:-/app/apps/web/.next}"

# `|` is the sed delimiter: URLs and base64url JWTs never contain one, while
# both routinely contain `/`.
substitute() {
  sentinel="$1"
  value="$2"
  files=$(grep -rlF "$sentinel" "$BUNDLE_DIR" 2>/dev/null || true)
  [ -n "$files" ] || return 0
  # Unset stays empty rather than leaving the `.invalid` host in place: with an
  # empty value the app falls back to its in-memory demo store, which is a
  # working product. Pointing it at an unresolvable host is not.
  echo "$files" | while IFS= read -r file; do
    sed -i "s|$sentinel|$value|g" "$file"
  done
  echo "ciele: applied runtime value for $sentinel ($(echo "$files" | wc -l | tr -d ' ') files)"
}

case "${NEXT_PUBLIC_SUPABASE_URL:-}" in
  *'|'*)
    echo "ciele: NEXT_PUBLIC_SUPABASE_URL contains '|', which this substitution cannot express." >&2
    exit 1
    ;;
esac
case "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" in
  *'|'*)
    echo "ciele: NEXT_PUBLIC_SUPABASE_ANON_KEY contains '|', which this substitution cannot express." >&2
    exit 1
    ;;
esac

substitute "$SENTINEL_URL" "${NEXT_PUBLIC_SUPABASE_URL:-}"
substitute "$SENTINEL_ANON_KEY" "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}"

exec "$@"
