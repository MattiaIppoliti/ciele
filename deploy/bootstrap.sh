#!/usr/bin/env bash
# Bring up a self-hosted Ciele from a clean checkout (#440).
#
#   ./deploy/bootstrap.sh              first run: generate, start, migrate
#   ./deploy/bootstrap.sh --seed       …and load the sanitized demo content
#   ./deploy/bootstrap.sh --env-only   just write deploy/.env, start nothing
#   ./deploy/bootstrap.sh --images vX.Y.Z
#                                      run published images, no source build
#
# Generates every secret the stack needs (Postgres password, JWT secret and
# the two API keys signed with it, the encryption key, the cron secret),
# writes deploy/.env, then starts the default profiles. Migrations and the
# three storage buckets are applied by the one-shot `migrate` service before
# the app accepts a request, so there is no manual step after this.
#
# Re-running is safe: an existing deploy/.env is never overwritten, so your
# secrets and edits survive.
set -euo pipefail

cd "$(cd "$(dirname "$0")" && pwd)"

ENV_FILE=".env"
SEED=0
ENV_ONLY=0
IMAGE_TAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --seed) SEED=1 ;;
    --env-only) ENV_ONLY=1 ;;
    --images)
      shift
      IMAGE_TAG="${1:-}"
      [ -n "$IMAGE_TAG" ] || {
        echo "--images needs a release tag, e.g. --images v0.4.0" >&2
        exit 2
      }
      ;;
    --images=*) IMAGE_TAG="${1#--images=}" ;;
    -h | --help)
      sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $1 (try --help)" >&2
      exit 2
      ;;
  esac
  shift
done

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Error: '$1' is required but not installed." >&2
    exit 1
  }
}
need openssl

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    echo "Error: Docker Compose is required (install Docker Desktop or the compose plugin)." >&2
    exit 1
  fi
}

# --- secret generation -------------------------------------------------------

# URL-safe base64 with no padding — the encoding JWTs use.
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

# A password/secret that is safe in a connection string (no @ : / #).
random_secret() { openssl rand -hex 32; }

# Mint an HS256 JWT for a Supabase role, signed with the stack's JWT secret.
# These are the anon and service_role keys: not credentials to look up
# anywhere, just claims this deployment signs for itself.
mint_key() {
  local role="$1" secret="$2" iat exp header payload signature
  iat=$(date +%s)
  # Ten years: rotating these means rotating JWT_SECRET, which is a
  # deliberate operation, not a routine expiry.
  exp=$((iat + 315360000))
  header=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  payload=$(printf '{"role":"%s","iss":"supabase","iat":%s,"exp":%s}' "$role" "$iat" "$exp" | b64url)
  signature=$(printf '%s' "${header}.${payload}" |
    openssl dgst -binary -sha256 -hmac "$secret" | b64url)
  printf '%s.%s.%s' "$header" "$payload" "$signature"
}

# Fill in one empty `KEY=` line. Secrets here are hex or base64, alphabets
# that exclude `|`, so it is a safe sed delimiter; nothing is ever echoed.
# The temp file keeps this portable across GNU and BSD sed.
set_var() {
  local key="$1" value="$2"
  sed "s|^${key}=$|${key}=${value}|" "$ENV_FILE" >"$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
}

# Same, but overwrites whatever the line already holds. Only used for the
# image-mode switch, which is a choice the caller is re-making — never for a
# secret, where silently replacing one would orphan the data it protects.
replace_var() {
  local key="$1" value="$2"
  sed "s|^${key}=.*$|${key}=${value}|" "$ENV_FILE" >"$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
}

if [ -f "$ENV_FILE" ]; then
  echo "Keeping the existing $PWD/$ENV_FILE (delete it to regenerate secrets)."
else
  echo "Generating secrets → $PWD/$ENV_FILE"
  postgres_password=$(random_secret)
  jwt_secret=$(random_secret)
  anon_key=$(mint_key anon "$jwt_secret")
  service_role_key=$(mint_key service_role "$jwt_secret")
  app_encryption_key=$(openssl rand -base64 32)
  cron_secret=$(random_secret)

  # Start from the documented template so every option stays visible and
  # commented, then fill in what we generated.
  cp .env.example "$ENV_FILE"
  set_var POSTGRES_PASSWORD "$postgres_password"
  set_var JWT_SECRET "$jwt_secret"
  set_var ANON_KEY "$anon_key"
  set_var SERVICE_ROLE_KEY "$service_role_key"
  set_var APP_ENCRYPTION_KEY "$app_encryption_key"
  set_var CRON_SECRET "$cron_secret"
  chmod 600 "$ENV_FILE"
  echo "Wrote $(grep -c '^[A-Z]' "$ENV_FILE") settings; six secrets generated."
fi

# --- image mode --------------------------------------------------------------
#
# Written into .env rather than passed on the command line, so a later bare
# `docker compose up -d` in this directory keeps running images too — compose
# reads COMPOSE_FILE from .env itself.
if [ -n "$IMAGE_TAG" ]; then
  replace_var COMPOSE_FILE "docker-compose.yml:docker-compose.images.yml"
  replace_var CIELE_IMAGE_TAG "$IMAGE_TAG"
  echo "Image mode: app, migrate and cron will be pulled at $IMAGE_TAG (no source build)."
fi

# The overlay is on when .env says so, whether this run set it or a previous
# one did. Every compose invocation below has to agree with that, and the
# explicit `-f` flags would otherwise override what .env asked for.
compose_files() {
  local configured
  configured=$(grep -E '^COMPOSE_FILE=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
  configured="${configured:-docker-compose.yml}"
  local IFS=':'
  for file in $configured; do
    printf ' -f %s' "$file"
  done
}

# A source build is what `--build` forces; in image mode it would rebuild the
# very thing the pinned tag exists to avoid.
build_flag() {
  case "$(compose_files)" in
    *docker-compose.images.yml*) printf '' ;;
    *) printf -- '--build' ;;
  esac
}

if [ "$ENV_ONLY" = "1" ]; then
  echo "Done (--env-only). Start the stack with: docker compose$(compose_files) up -d"
  exit 0
fi

# --- start -------------------------------------------------------------------

# The demo seed rides along with the migration container's single pass.
if [ "$SEED" = "1" ]; then
  export LOAD_DEMO_SEED=1
  echo "The sanitized demo seed will be loaded after migrations."
fi

if [ -z "$(build_flag)" ]; then
  echo "Pulling published images and starting the stack…"
else
  echo "Building and starting the stack (first run pulls images and builds the app — several minutes)…"
fi
# shellcheck disable=SC2046,SC2086 # both helpers emit deliberate argument lists
compose --env-file "$ENV_FILE" $(compose_files) up -d $(build_flag)

app_port=$(grep -E '^APP_PORT=' "$ENV_FILE" | cut -d= -f2)
app_port="${app_port:-3000}"

cat <<EOF

Ciele is starting.

  App        http://localhost:${app_port}
  Database   the Supabase OSS stack, in this compose project only

The first account you sign up becomes the owner of its organization. Set
PLATFORM_OWNER_EMAIL in deploy/.env before signing up if that account should
also own platform-wide settings.

  Follow the boot:   docker compose -f deploy/docker-compose.yml logs -f app
  Stop:              docker compose -f deploy/docker-compose.yml down
  Wipe everything:   docker compose -f deploy/docker-compose.yml down -v

TLS is not handled here — put your own reverse proxy in front and terminate
there. See deploy/README.md for the workers profile, upgrades and backups.
EOF
