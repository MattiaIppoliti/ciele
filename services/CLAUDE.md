# services/, out-of-band workers

Python/container workers that run **outside** the pnpm workspace. They are not turbo tasks and
have no `package.json`; `pnpm test` at the root does not cover them.

| Service | Role |
|---|---|
| `crawl4ai-worker` | Crawl4AI website-crawl provider (one of the three-provider matrix, Local / Crawl4AI / Apify) |
| `graph-worker` | Graph knowledge layer / derived index (ADR-0017) |

## Conventions

- Each service owns a `README.md` (what it is) **and** a `RUNBOOK.md` (how to operate it when it
  breaks). Behaviour changes that affect operations go in the RUNBOOK in the same change.
- Deployment target is Cloud Run: see each service's `cloudrun/`. `docker-compose.yml` is for
  local runs only.
- `apps/web` talks to these over HTTP through the runtime's provider layer
  (`src/packages/agent/src/crawl4ai.ts`, `graph-worker.ts`); those callers have vitest coverage, the
  workers themselves are exercised by their own scripts.
- Crawl-provider behaviour and the Automatic capability policy are documented in
  `docs/runbooks/website-crawler-providers.md`: keep it in sync when provider selection changes.
