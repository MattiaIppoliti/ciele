# services/, out-of-band workers

Workers and services that run **outside** the pnpm workspace. They are not turbo tasks and
have no `package.json`; `pnpm test` at the root does not cover them.

| Service | Role |
|---|---|
| `crawl4ai-worker` | Crawl4AI website-crawl provider (one of the three-provider matrix, Local / Crawl4AI / Apify) |
| `ciele-api` | Rust (axum + sqlx) service that runs `@ciele/ops` operations ported from TypeScript, one domain at a time (map #1111). Off unless `apps/web` lists operations in `CIELE_RUST_OPERATIONS` |

## Conventions

- Each service owns a `README.md` (what it is) **and** a `RUNBOOK.md` (how to operate it when it
  breaks). Behaviour changes that affect operations go in the RUNBOOK in the same change.
- Deployment target is Cloud Run: see each service's `cloudrun/`. `docker-compose.yml` is for
  local runs only.
- `apps/web` talks to these over HTTP through the runtime's provider layer
  (`packages/agent/src/crawl4ai.ts`); that caller has vitest coverage, the
  workers themselves are exercised by their own scripts.
- Crawl-provider behaviour and the Automatic capability policy are documented in
  `docs/runbooks/website-crawler-providers.md`: keep it in sync when provider selection changes.
- `ciele-api` is not a Cloud Run worker yet: where it runs in production is open (#1126). Its
  contract with `apps/web` is `packages/ops/src/remote.ts` on one side and `src/assertion.rs` on
  the other; change both together, and add every ported operation to
  `packages/ops/src/rust-parity.test.ts`, which is the only thing that proves the port answers
  what the TypeScript body answered. A new row in `OPERATIONS` (`src/lib.rs`) fails that test
  until `RUST_OPERATIONS` in `remote.ts`, the test's `PORTS` table and the README table name it.
  `pnpm verify` runs `cargo test` and the parity test (`scripts/verify-rust.sh`).
