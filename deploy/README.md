# Self-hosting Ciele

Everything needed to run Ciele on your own machine or server: the whole
product — admin console, widget runtime, database, background jobs — with no
account anywhere and no license fee.

```sh
git clone <this repo> && cd ciele
./deploy/bootstrap.sh          # generates every secret, starts the stack
```

First run pulls images and builds the app, so give it several minutes. When it
finishes, open <http://localhost:3000> and sign up — **the first account
becomes the owner of its organization**.

Add `--seed` to load sanitized demo content (an organization with example
assistants) so you can see a populated product before adding your own.

## What runs

`docker compose` profiles, set by `COMPOSE_PROFILES` in `deploy/.env`:

| Profile | Default | What it is |
|---|:--:|---|
| `db` | ✅ | The Supabase OSS stack, trimmed: Postgres + pgvector, GoTrue (auth), PostgREST (data API), storage-api, and a small nginx gateway giving them one origin |
| `migrate` | ✅ | One-shot. Applies pending migrations and provisions the three storage buckets, then the app starts |
| `app` | ✅ | The web app — admin console and widget runtime |
| `cron` | ✅ | The five scheduled jobs, on the same UTC schedules the hosted deployment uses |
| `workers` | ⬜ | Graph retrieval + JavaScript-rendering crawler. Heavy (~8 GiB RAM) |
| `studio` | ⬜ | Database admin UI |

Realtime, Edge Functions, Analytics and Kong are not started — Ciele does not
use them.

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
OPENAI_COMPATIBLE_EMBEDDING_DIMS=768
```

`docker compose -f deploy/docker-compose.yml up -d app` to apply. Hosted
providers work too — set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or
`GOOGLE_GENERATIVE_AI_API_KEY` instead.

**Without an embedding model, knowledge search degrades to keyword/lexical
matching.** Answers still work; retrieval is just less able to match meaning.
The same applies to the `workers` profile: without the graph worker there is
no derived-graph retrieval, and without Crawl4AI the built-in fetch-based
crawler handles websites (fine for server-rendered pages, weaker on
JavaScript-heavy ones).

## Turning on the heavy workers

```sh
# deploy/.env
COMPOSE_PROFILES=db,migrate,app,cron,workers
GRAPH_WORKER_API_TOKEN=<openssl rand -hex 32>
GRAPH_LLM_API_KEY=<key for the graph worker's LLM>
CRAWL4AI_API_TOKEN=<openssl rand -hex 32>
CRAWL4AI_SECRET_KEY=<openssl rand -hex 32>
```

Then `docker compose -f deploy/docker-compose.yml up -d`. Budget ~8 GiB of RAM
for the two of them.

## TLS and exposure

**TLS is your responsibility.** This stack listens on plain HTTP and expects a
reverse proxy (Caddy, nginx, Traefik) in front of it terminating TLS. When you
add one, set `PUBLIC_URL` and `SUPABASE_PUBLIC_URL` in `deploy/.env` to the
public HTTPS origins and rebuild the app image — the browser bundle inlines
`SUPABASE_PUBLIC_URL` at build time:

```sh
docker compose -f deploy/docker-compose.yml up -d --build app
```

Only two ports are published by default: the app (3000) and the Supabase
gateway (8000). Postgres is not exposed outside the compose network.

## Day two

```sh
# logs
docker compose -f deploy/docker-compose.yml logs -f app

# upgrade: pull the new code, rebuild, migrate (the migrate service reruns
# automatically and applies only what is pending)
git pull && docker compose -f deploy/docker-compose.yml up -d --build

# back up the database
docker compose -f deploy/docker-compose.yml exec -T postgres \
  pg_dump -U postgres postgres | gzip > ciele-$(date +%F).sql.gz

# stop / wipe
docker compose -f deploy/docker-compose.yml down
docker compose -f deploy/docker-compose.yml down -v   # also deletes data
```

Uploaded files live in the `storage-data` volume and the database in
`postgres-data`; back up both.

## Not in scope

Kubernetes/Helm charts, TLS termination, and multi-node scale-out. This is a
single-host deployment; for anything larger, treat the compose file as a
reference for what the product needs.

## Troubleshooting

**`migrate` exits with "schema 'auth' did not appear"** — GoTrue failed to
start, usually a Postgres password mismatch from a half-initialised volume.
`docker compose -f deploy/docker-compose.yml down -v` and bootstrap again.

**Signup emails never arrive** — with no SMTP configured, accounts are
auto-confirmed (`MAILER_AUTOCONFIRM=true`), so just sign in. Set the `SMTP_*`
variables and flip it to `false` when you want real confirmation.

**The app can't reach Ollama on the host** — inside Docker, `localhost` is the
container. Use `http://host.docker.internal:11434/v1` (Docker Desktop) or the
host's LAN IP (Linux).
