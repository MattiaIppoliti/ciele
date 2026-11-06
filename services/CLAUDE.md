# services/, out-of-band workers

Workers and services that run **outside** the pnpm workspace. They are not turbo tasks and
have no `package.json`; `pnpm test` at the root does not cover them.

| Service | Role |
|---|---|
| `crawl4ai-worker` | Crawl4AI website-crawl provider (one of the three-provider matrix, Local / Crawl4AI / Apify) |
| `ciele-api` | Rust (axum + sqlx) service that runs `@ciele/ops` operations ported from TypeScript, one domain at a time (map #1111). Off unless `apps/web` lists operations in `CIELE_RUST_OPERATIONS` or widget endpoints in `CIELE_RUST_WIDGET_ROUTES` |

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
- `ciele-api` also answers the `/api/v1` endpoints of its operations itself (#1134):
  `src/v1.rs` and `RUST_DIRECT_ENDPOINTS` in `apps/web/src/lib/rust-routing.ts` are
  one list in two languages, held together by `rust-routing.test.ts` (derived from the route
  files) and `rust-direct.parity.test.ts` (against the binary). A route that changes its
  body check, status or response shape has to change `src/v1.rs` in the same PR.
- It serves the hosted MCP endpoint as well (#1135). Its tool list is `packages/mcp/golden`,
  recorded from the TypeScript server, and `src/mcp_tools/` (a module per tool) ports `packages/mcp/src/tools.ts`
  action by action. A change to a tool or to a `@ciele/client` method it calls has to re-record
  the golden and change the tool's module under `src/mcp_tools/` in the same PR; `rust-mcp.parity.test.ts` fails until
  it does.
- The public widget endpoints (#1136) are a third surface, with no assertion:
  `src/widget/` on this side, `RUST_WIDGET_ROUTES` in the same `rust-routing.ts` on the
  other, held together by `apps/web/src/app/api/widget/rust-parity.test.ts`, which
  `pnpm verify` runs too. `rust-routing.ts` is the only place the web app decides what goes
  to the service, and it reads every variable by name (an Edge bundle gets only those): add
  a surface there, never a second routing helper in the middleware.
