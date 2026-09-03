# Self-hosting Ciele

Everything needed to run Ciele on your own machine or server: the whole
product, admin console, widget runtime, database, background jobs, with no
account anywhere and no license fee.

```sh
curl -fsSL https://ciele.app/install.sh | sh
```

That installer checks the prerequisites, fetches the source into `./ciele` and
runs the script below; `| sh -s -- --seed` forwards flags to it, and `CIELE_DIR`
/ `CIELE_REF` choose the directory and the release tag. It is generated from
`apps/web/src/lib/self-host-install.ts`, whose test pins it to this script, so
a flag renamed here fails the build rather than someone's install.

By hand, which is all it does:

```sh
git clone <this repo> && cd ciele
./deploy/bootstrap.sh          # generates every secret, starts the stack
```

First run pulls images and builds the app, so give it several minutes. When it
finishes, open <http://localhost:3000> and sign up, **the first account
becomes the owner of its organization**.

Add `--seed` to load sanitized demo content (an organization with example
assistants) so you can see a populated product before adding your own.

## What runs

`docker compose` profiles, set by `COMPOSE_PROFILES` in `deploy/.env`:

| Profile | Default | What it is |
|---|:--:|---|
| `db` | ✅ | The Supabase OSS stack, trimmed: Postgres + pgvector, GoTrue (auth), PostgREST (data API), storage-api, and a small nginx gateway giving them one origin |
| `migrate` | ✅ | One-shot. Applies pending migrations and provisions the three storage buckets, then the app starts. On a fresh install it applies the **whole** chain from the first migration: the hosted project's `migrations-baseline.txt` reconciliation is skipped when there is no existing schema to reconcile with |
| `app` | ✅ | The web app: admin console and widget runtime |
| `cron` | ✅ | The five scheduled jobs, on the same UTC schedules the hosted deployment uses |
| `studio` | ⬜ | Database admin UI |

Realtime, Edge Functions, Analytics and Kong are not started; Ciele does not
use them.

Three things are not profiles but **overlay files**, listed in `COMPOSE_FILE`:
prebuilt images, the heavy workers, and an external database. All three are
covered below.

## Bring your own Postgres

If your institution already runs a managed Postgres you would rather keep
Ciele's data in, point the stack at it and the `postgres` container never
starts:

```sh
./deploy/bootstrap.sh --database-url postgresql://admin:password@host:5432/dbname
```

The URL is the **admin login the provider created with the server** (the
Azure admin user, the RDS master user, Cloud SQL's `postgres`, a Neon console
role) on the **direct** hostname, never a pooler. Bootstrap splits it into the
`EXTERNAL_DB_*` lines of `deploy/.env`, mints the one password the three
service logins share, lists `docker-compose.external-db.yml` in `COMPOSE_FILE`,
and runs a preflight before starting anything: Postgres 16 or newer, `vector`
and `pg_trgm` available, an admin that can create roles, enough connections
for the stack, TLS accepted. Each failure is one line saying what to change.

On `up`, a one-shot `provision` service (the migrate image with a second
entrypoint) recreates as that admin what the `supabase/postgres` image used to
bake in: the roles, the `auth` / `storage` / `extensions` schemas, the
`auth.uid()` helpers, default privileges, the two extensions. GoTrue,
PostgREST, storage-api and the migration applier then run against your
database exactly as they run against the container. Re-running `up` re-runs
provisioning; it is idempotent.

What it needs from the provider, and why:

| Requirement | Reason |
|---|---|
| Postgres **16+** | On 15 only a superuser may create a `BYPASSRLS` role, and no managed provider gives you one |
| An admin that holds **`BYPASSRLS`** | `service_role` must bypass row-level security; the service key's reads assume it. Azure 16+, Neon and the RDS/Aurora/Cloud SQL/AlloyDB master users qualify |
| `vector` + `pg_trgm` creatable | Azure: add both to the `azure.extensions` server parameter first. RDS: the master user creates `vector`. Elsewhere the admin can |
| The admin **owns the database** | Postgres 15+ gives the `public` schema to the database owner; the chain creates every table there |
| The **direct** endpoint, TLS on | PostgREST and storage-api hold a `LISTEN` connection; GoTrue's migrations rely on the role's `search_path`. Neither survives transaction pooling. Every URL uses `sslmode=require`; `--db-ca <file>` upgrades to `verify-full` |
| ~25 connections at peak | Cloud SQL `db-f1-micro` allows 25 in total; pick `db-g1-small` or larger. Neon Free, Azure B1ms and RDS t4g.micro are fine |

Works with `--images` (the provision service pulls the published migrate image)
and `--workers`. Uploaded files still live in the local `storage-data` volume:
back it up together with the provider's database backups, they are one
dataset. A hosted Supabase project cannot be the database *under* these
containers (its roles exist with passwords you do not hold); point the app at
such a project instead, with no `db` profile. Decision record:
[`docs/adr/0022-self-host-database-pluggable-postgres.md`](../docs/adr/0022-self-host-database-pluggable-postgres.md).

## Prebuilt images instead of a source build

The command above builds `app`, `migrate` and `cron` from the checkout, an
afternoon on a laptop, and it needs the whole repo. Every release also
publishes those three as images, so you can skip the build entirely:

```sh
./deploy/bootstrap.sh --images v0.4.0
```

That writes two lines into `deploy/.env` and pulls instead of building:

```sh
COMPOSE_FILE=docker-compose.yml:docker-compose.images.yml
CIELE_IMAGE_TAG=v0.4.0
```

Because they live in `.env`, a later bare `docker compose up -d` in this
directory stays in image mode. To go back to building from source, clear both
lines. Available tags are the release tags of this repository; set
`CIELE_IMAGE_REGISTRY` to run a mirror or your own rebuild.

Everything else is identical: same profiles, same migrate-before-app ordering,
same database layer. Only the origin of those three services changes.

> **Why the published app image is configurable at all.** Next.js inlines
> `NEXT_PUBLIC_*` at build time, and one of those values is the Supabase anon
> key, a JWT signed with *your* install's secret, which no published image can
> know. So the image is built with placeholders and rewrites them from its
> environment on start (`apps/web/docker-entrypoint.sh`). Changing
> `SUPABASE_PUBLIC_URL` afterwards therefore needs the container recreated
> (`docker compose up -d`), not just restarted.

Ciele Desktop uses this mode: it pins the tag to its own version, so updating
the app is what rolls your local stack forward. If you want the guided,
no-terminal path, use the desktop app instead of this directory, see
<https://docs.ciele.app/self-hosting/desktop>.

## Choosing your AI models

Ciele talks to any server speaking the OpenAI chat/embeddings API, so a fully
local setup needs no provider account. With [Ollama](https://ollama.com)
running on the host:

```sh
ollama pull llama3.1:8b && ollama pull nomic-embed-text
```

then in `deploy/.env`:

```sh
OPENAI_COMPATIBLE_BASE_URL=http://host.docker.internal:11434/v1
OPENAI_COMPATIBLE_CHAT_MODEL=llama3.1:8b
OPENAI_COMPATIBLE_EMBEDDING_MODEL=nomic-embed-text
```

`docker compose -f deploy/docker-compose.yml up -d app` to apply. Hosted
providers work too, set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or
`GOOGLE_GENERATIVE_AI_API_KEY` instead.

**Without an embedding model, knowledge search degrades to keyword/lexical
matching.** Answers still work; retrieval is just less able to match meaning.
The same applies to the workers: without the graph worker there is no
derived-graph retrieval, and without Crawl4AI the built-in fetch-based crawler
handles websites (fine for server-rendered pages, weaker on JavaScript-heavy
ones).

## Turning on the heavy workers

```sh
./deploy/bootstrap.sh --workers
```

That adds the second overlay to `deploy/.env` and generates the three shared
secrets the pair needs:

```sh
COMPOSE_FILE=docker-compose.yml:docker-compose.workers.yml
GRAPH_WORKER_API_TOKEN=<generated>
CRAWL4AI_API_TOKEN=<generated>
CRAWL4AI_SECRET_KEY=<generated>
```

The fourth credential is yours to supply: set `GRAPH_LLM_API_KEY` to a key for
the graph worker's LLM (Gemini by default, `GRAPH_LLM_PROVIDER` and
`GRAPH_LLM_MODEL` change that), then run the command again. Budget ~8 GiB of
RAM for the pair.

`--workers` and `--images` compose, in either order, and neither turns the
other off. To stop running the workers, drop `docker-compose.workers.yml` from
`COMPOSE_FILE` and `docker compose up -d --remove-orphans`.

The workers are an overlay rather than a `workers` profile for one reason:
Compose interpolates every service in a file before it filters by profile, so
the `:?` guards that stop a worker from starting without its token used to
abort a plain `docker compose up` on a stack that was never going to run them.
A file nobody asked for is never read at all.

## TLS and exposure

**The stack ships its own TLS path** (#801, CYB-16): the
`docker-compose.tls.yml` overlay runs Caddy on 80/443, terminating HTTPS for
two hostnames (the app and the Supabase gateway) and provisioning its own
certificates via ACME. Point DNS for both names at the host, then:

```sh
# set the two names first; the script does not ask for them
printf 'CIELE_DOMAIN=app.example.edu\nCIELE_SUPABASE_DOMAIN=supabase.example.edu\n' >> deploy/.env
./deploy/bootstrap.sh --tls
```

`--tls` adds the overlay to `COMPOSE_FILE` and checks that both domains are
set in `.env`; when either is missing it prints what to set and exits 2
rather than let the Caddy container crash-loop on an empty hostname. It never
prompts. Or set `COMPOSE_FILE=docker-compose.yml:docker-compose.tls.yml` plus
the two domains in `.env` yourself. Caddy is the one deliberately public listener; the
app and gateway keep their loopback host ports. Prefer your own proxy (nginx,
Traefik, a cloud LB)? Skip the overlay and terminate there instead, the rest
of this section applies either way.

Whichever proxy terminates, set `PUBLIC_URL`, `SUPABASE_PUBLIC_URL` and
`CIELE_PUBLIC_ORIGIN` in `deploy/.env` to the public HTTPS origins.

In **source-build mode** that value is baked in, so the app image has to be
rebuilt:

```sh
docker compose -f deploy/docker-compose.yml up -d --build app
```

In **image mode** it is applied when the container starts, so recreating is
enough, but a restart is not:

```sh
docker compose up -d app
```

Only two ports are published by default: the app (3000) and the Supabase
gateway (8000), and both bind to `127.0.0.1`, so a stack brought up on a VPS is
not on the internet over plain HTTP before a reverse proxy exists (#801,
CYB-16). Put the proxy on the box and let it be what the world reaches, or set
`BIND_ADDRESS=0.0.0.0` in `.env` if you have decided otherwise. Studio ignores
`BIND_ADDRESS` and stays on loopback whatever it says: it is a database
console, reach it through an SSH tunnel. Postgres is not published at all.

The app enforces the other half of that at startup: a production build whose
`PUBLIC_URL`, `CIELE_PUBLIC_ORIGIN` or `NEXT_PUBLIC_APP_URL` (the one a
Vercel-style deploy sets) is `http://` on anything but a loopback host refuses
to start and says which variable in the container log, because
session cookies and signed links on that origin would travel in the clear. The
unedited `.env` (`PUBLIC_URL=http://localhost:3000`) passes. A LAN-only install
that has decided to run over HTTP sets `CIELE_ALLOW_INSECURE_HTTP=1` in `.env`;
the variable has to be typed, so it is a decision rather than a default.

## Day two

```sh
# logs
docker compose -f deploy/docker-compose.yml logs -f app

# upgrade: pull the new code, rebuild, migrate (the migrate service reruns
# automatically and applies only what is pending)
git pull && docker compose -f deploy/docker-compose.yml up -d --build

# upgrade in image mode: bump CIELE_IMAGE_TAG in deploy/.env, then
docker compose up -d

# back up the database
docker compose -f deploy/docker-compose.yml exec -T postgres \
  pg_dump -U postgres postgres | gzip > ciele-$(date +%F).sql.gz

# stop / wipe
docker compose -f deploy/docker-compose.yml down
docker compose -f deploy/docker-compose.yml down -v   # also deletes data
```

Uploaded files live in the `storage-data` volume and the database in
`postgres-data`; back up both.

## Programmatic access: API, CLI, MCP (#630)

A self-hosted deployment speaks the same `/api/v1` as the SaaS, no extra
services, no extra env vars: the routes ship inside the app container.

1. **Mint a key** in the admin console: *Settings → API Keys* (admin+). The
   key acts with the role you give it, capped at your own. The secret is
   shown once.
2. **Point anything at your deployment** with two variables:

```sh
export CIELE_API_KEY=ciele_sk_…
export CIELE_BASE_URL=https://ciele.your-campus.example   # this host

# discovery, what this deployment speaks (no auth needed)
curl "$CIELE_BASE_URL/api/v1/meta"
# the machine-readable contract
curl "$CIELE_BASE_URL/api/v1/openapi.json"

# the CLI (packages/cli, see its README for the full command tree)
ciele login --key "$CIELE_API_KEY" --base-url "$CIELE_BASE_URL"
ciele whoami
ciele assistants list
ciele flows create <assistantId> --name "Fees intent"
```

3. **MCP** (`packages/mcp`): the stdio server takes the same two variables,
   plus `CIELE_MCP_READ_ONLY=1` to let an agent explore without writing.
   Per-client setup (Claude Code, Claude Desktop, Cursor, VS Code/Copilot,
   Codex, Windsurf, Zed, OpenCode, Gemini CLI, …):
   [`docs/api/connect-ai-clients.md`](../docs/api/connect-ai-clients.md);
   architecture diagrams: [`docs/api/connections.md`](../docs/api/connections.md).

Version skew: a newer CLI against an older self-hosted server should call
`GET /api/v1/meta` first, `domains` lists what this deployment actually
ships, and unknown routes 404 cleanly.

## Not in scope

Kubernetes/Helm charts, TLS termination, and multi-node scale-out. This is a
single-host deployment; for anything larger, treat the compose file as a
reference for what the product needs.

## Troubleshooting

**`migrate` exits with "table 'auth.users' did not appear"**: GoTrue failed to
start, usually a Postgres password mismatch from a half-initialised volume.
`docker compose -f deploy/docker-compose.yml down -v` and bootstrap again.

**Signup emails never arrive**: with no SMTP configured, accounts are
auto-confirmed (`MAILER_AUTOCONFIRM=true`), so just sign in. Set the `SMTP_*`
variables and flip it to `false` when you want real confirmation.

**The app can't reach Ollama on the host**: inside Docker, `localhost` is the
container. Use `http://host.docker.internal:11434/v1` (Docker Desktop) or the
host's LAN IP (Linux).

**In image mode, compose says `CIELE_IMAGE_TAG` is required**: the overlay is
in `COMPOSE_FILE` but no tag is pinned. Set `CIELE_IMAGE_TAG` to a release tag,
or clear `COMPOSE_FILE` to go back to building from source. The variable
refuses to default on purpose: an unpinned stack that silently followed
`latest` would change under you.

**In image mode, every request fails after changing `SUPABASE_PUBLIC_URL`**,
the published app image resolves that value once, at container start. Recreate
the container with `docker compose up -d` rather than restarting it.
