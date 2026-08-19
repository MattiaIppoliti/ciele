# Crawl4AI worker

A pinned, authenticated, operationally bounded Crawl4AI container that backs the
Ciele Website Source **Crawl4AI** crawler provider. It exposes only the crawl,
status, and health capabilities the app needs and is deployable both locally
(Docker) and as a single private managed container service, over the same API
contract.

This directory is the **worker package**, the image pin, hardened config, auth
and health configuration, a smoke test, and a deployment/rollback runbook. The
Ciele-side adapter that speaks to it lives at
`packages/agent/src/crawl4ai.ts` and is not part of this package.

> Deployable services live under `services/` (top level). `apps/*` are the two
> Next.js apps and `packages/*` are JS libraries; this worker is neither; it is
> a container image plus config, so it sits in its own `services/` directory and
> is intentionally **not** a pnpm/Turbo workspace member (no `package.json`).

## API contract (must match the adapter)

The adapter calls exactly these endpoints; the worker exposes exactly these:

| Method | Path                    | Auth        | Purpose |
|--------|-------------------------|-------------|---------|
| `GET`  | `/health`               | none        | Server liveness (public; for platform probes) |
| `POST` | `/crawl/job`            | Bearer token| Submit an async crawl → `{ "task_id": "…" }` |
| `GET`  | `/crawl/job/{task_id}`  | Bearer token| Poll status → `{ "status", "results"\|"data"\|"result", "error" }` |

- **Auth**: a static operator token sent as `Authorization: Bearer <token>`. The
  app injects it as `CRAWL4AI_API_TOKEN`; the worker reads the same env var and
  constant-time-compares it. Every route except `/health` and `/token` is
  fail-closed (HTTP 401 without a valid token).
- **Base URL**: the app sets `CRAWL4AI_BASE_URL` to this worker's origin.
- Task statuses are matched case-insensitively; `completed` is the only ingested
  state, `completed`/`failed` are terminal, same as the adapter.

## Image pin

`unclecode/crawl4ai:0.9.1`: pinned, never `latest`. v0.9.x is the first line
whose authentication is **fail-closed on every route** (earlier versions left
the whole API open when `jwt_enabled` was `false`). It also disables arbitrary
hooks/JS execution by default and ships the `/crawl/job` async queue the adapter
targets. See [`RUNBOOK.md`](./RUNBOOK.md) for pinning by digest and upgrades.

## Layout

```
services/crawl4ai-worker/
  README.md                     this file
  RUNBOOK.md                    configuration, monitoring, upgrades, rollback, provisioning
  docker-compose.yml            local worker (pinned image + hardened config + health check)
  .env.example                  secret template (copy to .env; .env is git-ignored)
  config/
    crawl4ai.config.yml         hardened config mounted to /app/config.yml
  cloudrun/
    service.yaml                managed-container (Cloud Run) service template
  scripts/
    healthcheck.py              container health check (server + browser runtime)
    smoke-test.sh               submit a controlled crawl, observe a terminal result
```

## Quick start (local Docker)

```bash
cd services/crawl4ai-worker
cp .env.example .env
# edit .env: set CRAWL4AI_API_TOKEN and SECRET_KEY (see the file for generators)

docker compose up -d
docker compose ps          # wait for STATUS = healthy (server + browser verified)

# Point the Ciele app at it:
#   CRAWL4AI_BASE_URL=http://localhost:11235
#   CRAWL4AI_API_TOKEN=<same token as .env>

# Verify end-to-end (submits a controlled crawl, waits for a terminal result):
CRAWL4AI_API_TOKEN=$(grep '^CRAWL4AI_API_TOKEN=' .env | cut -d= -f2-) \
  ./scripts/smoke-test.sh
```

Managed-container deployment uses the identical config, auth, and contract, see
[`RUNBOOK.md`](./RUNBOOK.md).

## What stays disabled

Ciele owns enrichment (Concepts, chunking, embeddings, citations), so the worker
runs **no** LLM extraction, **no** arbitrary hooks or JS code
(`CRAWL4AI_HOOKS_ENABLED=false` → `/execute_js` returns 403), no file downloads,
and no login automation. Deep crawling is breadth-first and same-origin, bounded
by the product page budget. Login-protected, file-download, and proxy-dependent
crawls remain on Apify per the parent spec.
