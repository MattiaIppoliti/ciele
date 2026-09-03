#!/usr/bin/env bash
# Bring up a self-hosted Ciele from a clean checkout (#440).
#
#   ./deploy/bootstrap.sh              first run: generate, start, migrate
#   ./deploy/bootstrap.sh --seed       …and load the sanitized demo content
#   ./deploy/bootstrap.sh --env-only   just write deploy/.env, start nothing
#   ./deploy/bootstrap.sh --images vX.Y.Z
#                                      run published images, no source build
#   ./deploy/bootstrap.sh --workers    …and the heavy graph + crawler workers
#   ./deploy/bootstrap.sh --database-url postgresql://admin:password@host:5432/db
#                                      run on a managed Postgres you already own
#                                      (Azure, RDS/Aurora, Cloud SQL/AlloyDB, Neon);
#                                      the postgres container never starts
#   ./deploy/bootstrap.sh --database-url … --db-ca ./provider-ca.pem
#                                      …and verify the server against that CA
#                                      (verify-full; RDS and Cloud SQL need it)
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

# Resolved before the cd, or a relative $0 (./deploy/bootstrap.sh --help)
# no longer names this file once we are inside deploy/.
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SELF")"

ENV_FILE=".env"
SEED=0
ENV_ONLY=0
IMAGE_TAG=""
WORKERS=0
TLS=0
DB_URL=""
DB_CA=""
# Resolved before the cd below, like $SELF: a relative --db-ca path names a
# file where the operator stands, not inside deploy/.
START_DIR="$PWD"
while [ $# -gt 0 ]; do
  case "$1" in
    --seed) SEED=1 ;;
    --env-only) ENV_ONLY=1 ;;
    --workers) WORKERS=1 ;;
    --tls) TLS=1 ;;
    --database-url)
      shift
      DB_URL="${1:-}"
      [ -n "$DB_URL" ] || {
        echo "--database-url needs the admin connection string, e.g. --database-url postgresql://admin:password@host:5432/db" >&2
        exit 2
      }
      ;;
    --database-url=*) DB_URL="${1#--database-url=}" ;;
    --db-ca)
      shift
      DB_CA="${1:-}"
      [ -n "$DB_CA" ] || {
        echo "--db-ca needs the path of the provider's CA bundle (PEM), e.g. --db-ca ./global-bundle.pem" >&2
        exit 2
      }
      ;;
    --db-ca=*) DB_CA="${1#--db-ca=}" ;;
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
      # The header block, however long it is: a line range drifts every time
      # a flag is added, and silently truncated the last line for a while.
      awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$SELF"
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

# URL-safe base64 with no padding, the encoding JWTs use.
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
# image-mode switch, which is a choice the caller is re-making, never for a
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

# --- overlays ----------------------------------------------------------------
#
# Image mode and the workers are both overlay files, and either can be on
# without the other, so COMPOSE_FILE is composed from what .env already says
# plus what this run asked for. It goes into .env rather than onto the command
# line so a later bare `docker compose up -d` in this directory keeps the same
# shape: compose reads COMPOSE_FILE from .env itself.
listed() { case ":$1:" in *":$2:"*) return 0 ;; *) return 1 ;; esac; }

configured=$(grep -E '^COMPOSE_FILE=' "$ENV_FILE" | cut -d= -f2- || true)
overlays="${configured:-docker-compose.yml}"
overlays_before="$overlays"

if [ -n "$IMAGE_TAG" ]; then
  listed "$overlays" docker-compose.images.yml ||
    overlays="$overlays:docker-compose.images.yml"
  replace_var CIELE_IMAGE_TAG "$IMAGE_TAG"
  echo "Image mode: app, migrate and cron will be pulled at $IMAGE_TAG (no source build)."
fi

if [ "$WORKERS" = "1" ]; then
  listed "$overlays" docker-compose.workers.yml ||
    overlays="$overlays:docker-compose.workers.yml"
  # Three of the four worker credentials are shared secrets this stack invents
  # for itself, so generate them the same way as the rest. The fourth, the
  # graph worker's LLM key, is an account of yours and cannot be minted here.
  set_var GRAPH_WORKER_API_TOKEN "$(random_secret)"
  set_var CRAWL4AI_API_TOKEN "$(random_secret)"
  set_var CRAWL4AI_SECRET_KEY "$(random_secret)"
  echo "Workers: the graph worker and the crawler are on (budget ~8 GiB of RAM)."
  if ! grep -q '^GRAPH_LLM_API_KEY=.' "$ENV_FILE"; then
    echo "GRAPH_LLM_API_KEY is empty in $PWD/$ENV_FILE; the graph worker cannot start without it." >&2
    [ "$ENV_ONLY" = "1" ] || exit 2
  fi
fi

if [ "$TLS" = "1" ]; then
  listed "$overlays" docker-compose.tls.yml ||
    overlays="$overlays:docker-compose.tls.yml"
  # The two hostnames are yours, not something this script can invent; refuse
  # loudly now rather than let the caddy container crash-loop on an empty
  # domain later (#801, CYB-16).
  if ! grep -q '^CIELE_DOMAIN=.' "$ENV_FILE" || ! grep -q '^CIELE_SUPABASE_DOMAIN=.' "$ENV_FILE"; then
    echo "Set CIELE_DOMAIN and CIELE_SUPABASE_DOMAIN in $PWD/$ENV_FILE first: the TLS proxy needs the names it should answer for (DNS must point here)." >&2
    [ "$ENV_ONLY" = "1" ] || exit 2
  fi
  echo "TLS: Caddy will terminate HTTPS for CIELE_DOMAIN and CIELE_SUPABASE_DOMAIN on 80/443."
fi

# --- external database (#812) ---------------------------------------------------
#
# One admin connection string is the whole contract. It is split into the
# EXTERNAL_DB_* lines the overlay reads, the one password the three service
# logins share is minted here, and the rest (roles, schemas, helpers,
# extensions) is the `provision` service's job at `up`. Refusals that need no
# connection happen now; the ones that do happen in the preflight below,
# before any container starts.
db_fail() {
  echo "Error: $1" >&2
  [ -z "${2:-}" ] || echo "       $2" >&2
  exit 2
}

# Sets db_user db_pass db_host db_port db_name from a postgresql:// URL.
parse_database_url() {
  local url="$1" rest userinfo hostpart pathq
  case "$url" in
    postgresql://* | postgres://*) ;;
    *) db_fail "--database-url must be a postgresql:// connection string." ;;
  esac
  rest="${url#*://}"
  # Split at the LAST @: a password with a stray @ then lands in the password
  # check below (and is refused with the percent-encoding hint) instead of
  # silently becoming part of the hostname.
  userinfo="${rest%@*}"
  [ "$userinfo" != "$rest" ] ||
    db_fail "--database-url needs the admin login: postgresql://USER:PASSWORD@host:5432/db." \
      "Use the admin the provider created with the server (Azure admin login, RDS master user, Cloud SQL 'postgres', the Neon console role)."
  hostpart="${rest##*@}"
  pathq="${hostpart#*/}"
  [ "$pathq" != "$hostpart" ] || db_fail "--database-url has no database name: postgresql://user:password@host:5432/DATABASE."
  hostpart="${hostpart%%/*}"
  db_user="${userinfo%%:*}"
  db_pass="${userinfo#*:}"
  [ "$db_pass" != "$userinfo" ] && [ -n "$db_pass" ] ||
    db_fail "--database-url has no password: postgresql://user:PASSWORD@host:5432/db."
  db_host="${hostpart%%:*}"
  db_port="${hostpart#*:}"
  [ "$db_port" != "$hostpart" ] || db_port=5432
  db_name="${pathq%%\?*}"
  [ -n "$db_host" ] && [ -n "$db_name" ] || db_fail "--database-url is missing its host or database name."
  # Hosted Supabase first: its pooler host would otherwise match the generic
  # pooler pattern and get the less useful message.
  case "$db_host" in
    db.*.supabase.co | *.pooler.supabase.com)
      db_fail "'$db_host' is a hosted Supabase project." \
        "Its roles already exist with passwords you do not hold, and its own GoTrue/PostgREST/Storage own the auth and storage schemas. Point the app at that project instead of running these containers against it."
      ;;
    *-pooler.* | *.pooler.* | *pgbouncer*)
      db_fail "'$db_host' looks like a connection pooler." \
        "PostgREST and storage-api hold a LISTEN connection and GoTrue relies on the role's search_path; none of that survives transaction pooling. Use the direct endpoint (Neon: drop '-pooler' from the host)."
      ;;
  esac
  case "$url" in
    *sslmode=disable*) db_fail "sslmode=disable is not supported." "Every managed provider offers TLS and most require it; drop the parameter (the stack uses sslmode=require) or use --db-ca for verify-full." ;;
  esac
  # The parts are re-assembled into compose URLs by plain interpolation, so a
  # character that ends a URL component would silently truncate the string.
  # Percent-encoding passes through untouched (libpq decodes it).
  case "$db_pass$db_user" in
    *[@:/\#?\ ]*) db_fail "the user or password in --database-url contains one of @ : / # ? or a space." "Percent-encode it (%40 for @, %3A for :, %2F for /, %23 for #, %3F for ?, %20 for space) or set a simpler admin password." ;;
  esac
}

if [ -n "$DB_URL" ]; then
  parse_database_url "$DB_URL"
  listed "$overlays" docker-compose.external-db.yml ||
    overlays="$overlays:docker-compose.external-db.yml"
  # The admin's coordinates are a choice the caller is re-making, so they are
  # overwritten; the shared service password is a secret, minted once.
  replace_var EXTERNAL_DB_HOST "$db_host"
  replace_var EXTERNAL_DB_PORT "$db_port"
  replace_var EXTERNAL_DB_NAME "$db_name"
  replace_var EXTERNAL_DB_ADMIN_USER "$db_user"
  replace_var EXTERNAL_DB_ADMIN_PASSWORD "$db_pass"
  set_var EXTERNAL_DB_SERVICE_PASSWORD "$(random_secret)"
  echo "External database: ${db_host}:${db_port}/${db_name} as ${db_user}; the postgres container will not start."
fi

# --db-ca (#814): one CA bundle, delivered to every consumer. GoTrue, PostgREST,
# psql (provision and the applier) read `sslrootcert=` from the URL; storage-api
# is Node and reads NODE_EXTRA_CA_CERTS. The overlay mounts the file at one
# path inside every container and derives both from EXTERNAL_DB_CA_FILE, so
# this only has to copy the bundle beside the compose files and flip the mode.
if [ -n "$DB_CA" ]; then
  listed "$overlays" docker-compose.external-db.yml ||
    db_fail "--db-ca only makes sense with an external database." "Pass --database-url in the same run, or run it first."
  case "$DB_CA" in /*) ca_src="$DB_CA" ;; *) ca_src="$START_DIR/$DB_CA" ;; esac
  [ -f "$ca_src" ] || db_fail "--db-ca: '$DB_CA' is not a file."
  grep -q 'BEGIN CERTIFICATE' "$ca_src" ||
    db_fail "--db-ca: '$DB_CA' does not look like a PEM certificate bundle." \
      "RDS: https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem. Cloud SQL: the instance's server-ca.pem. Azure: DigiCert Global Root G2 + Microsoft RSA Root CA 2017 concatenated."
  mkdir -p external-db
  cp "$ca_src" external-db/db-ca.pem
  chmod 644 external-db/db-ca.pem
  replace_var EXTERNAL_DB_CA_FILE ./external-db/db-ca.pem
  replace_var EXTERNAL_DB_SSLMODE verify-full
  echo "Database TLS: verify-full against $(grep -c 'BEGIN CERTIFICATE' external-db/db-ca.pem) certificate(s) from ${DB_CA}."
fi

# In image mode the provision service must pull the published migrate image
# (it is the same image with a second entrypoint) rather than build it, which
# would need the whole checkout. Decided from what .env ends up saying, so the
# two switches may arrive in either order or in separate runs.
if listed "$overlays" docker-compose.external-db.yml; then
  if listed "$overlays" docker-compose.images.yml; then
    registry=$(grep -E '^CIELE_IMAGE_REGISTRY=' "$ENV_FILE" | cut -d= -f2- || true)
    tag=$(grep -E '^CIELE_IMAGE_TAG=' "$ENV_FILE" | cut -d= -f2- || true)
    replace_var CIELE_PROVISION_IMAGE "${registry:-ghcr.io/mattiaippoliti/ciele}/migrate:${tag}"
    replace_var CIELE_PROVISION_PULL_POLICY always
  else
    replace_var CIELE_PROVISION_IMAGE ""
    replace_var CIELE_PROVISION_PULL_POLICY ""
  fi
fi

[ "$overlays" = "$overlays_before" ] || replace_var COMPOSE_FILE "$overlays"

# Which overlays are on is whatever .env says, whether this run set them or a
# previous one did. Every compose invocation below has to agree with that, and
# the explicit `-f` flags would otherwise override what .env asked for.
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

# Preflight the external database before anything else starts: version,
# extensions, privileges, connection budget, TLS, each refusal one actionable
# line. The provision service in check-only mode is what runs it, so the
# checks and the provisioning can never disagree about what they need.
external_db=0
case "$(compose_files)" in *docker-compose.external-db.yml*) external_db=1 ;; esac
if [ "$external_db" = "1" ]; then
  echo "Checking the external database…"
  # shellcheck disable=SC2046,SC2086
  compose --env-file "$ENV_FILE" $(compose_files) run --rm $(build_flag) \
    -e PROVISION_MODE=preflight provision
fi

if [ -z "$(build_flag)" ]; then
  echo "Pulling published images and starting the stack…"
else
  echo "Building and starting the stack (first run pulls images and builds the app, several minutes)…"
fi
# shellcheck disable=SC2046,SC2086 # both helpers emit deliberate argument lists
compose --env-file "$ENV_FILE" $(compose_files) up -d $(build_flag)

app_port=$(grep -E '^APP_PORT=' "$ENV_FILE" | cut -d= -f2)
app_port="${app_port:-3000}"

if [ "$external_db" = "1" ]; then
  database_line="$(grep -E '^EXTERNAL_DB_HOST=' "$ENV_FILE" | cut -d= -f2-)/$(grep -E '^EXTERNAL_DB_NAME=' "$ENV_FILE" | cut -d= -f2-) (your Postgres; auth, data API and storage run here against it)"
else
  database_line="the Supabase OSS stack, in this compose project only"
fi

cat <<EOF

Ciele is starting.

  App        http://localhost:${app_port}
  Database   ${database_line}

The first account you sign up becomes the owner of its organization. Set
PLATFORM_OWNER_EMAIL in deploy/.env before signing up if that account should
also own platform-wide settings.

  Follow the boot:   docker compose -f deploy/docker-compose.yml logs -f app
  Stop:              docker compose -f deploy/docker-compose.yml down
  Wipe everything:   docker compose -f deploy/docker-compose.yml down -v

TLS: re-run with --tls (after setting CIELE_DOMAIN and CIELE_SUPABASE_DOMAIN
in deploy/.env) to start the bundled Caddy proxy on 80/443; or put your own
in front. See deploy/README.md for the workers profile, upgrades and backups.
EOF
