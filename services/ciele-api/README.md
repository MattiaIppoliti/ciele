# ciele-api

The Rust half of the backend rewrite (map #1111, first slice #1121). It runs
operations from `@ciele/ops`, one domain at a time, against the same Postgres
and under the same row-level security as the TypeScript body it replaces.

Nothing here is a second front door. `apps/web` still authenticates the caller,
checks the operation's capability and validates the input. Then, for an
operation named in `CIELE_RUST_OPERATIONS`, `defineOperation` posts the parsed
input here instead of running it in-process.

## What runs here

`OPERATIONS` in `src/lib.rs`, one row per operation. The parity test checks this
table against it and against each operation's TypeScript `capability`.

| Operation | Capability | TypeScript original |
|---|---|---|
| `alerts.list` | member | `packages/ops/src/configuration.ts` |
| `alerts.resolve` | edit | same |
| `alerts.update` | edit | same |
| `improvements.list` | member | `packages/ops/src/improvements.ts` |
| `improvements.listPage` | member | same |
| `improvements.fix.propose` | edit | same |
| `improvements.fix.dismiss` | edit | same |
| `taskLabels.list` | member | `packages/ops/src/task-labels.ts` |
| `taskLabels.create` | edit | same |
| `taskLabels.update` | edit | same |
| `taskLabels.delete` | edit | same |

## The contract

`POST /v1/ops/{operation}` with the parsed input as the JSON body and an
`x-ciele-assertion` header. It answers `200 {"result": …}`, or
`{"error": {"code", "message"}}` with a status:

| Code | Status | What the web app does with it |
|---|---|---|
| `not_found`, `invalid_input`, `conflict` | 404, 422, 409 | throws the `OperationError` the TypeScript body would have thrown |
| `unauthorized` | 401 | bad, expired or missing assertion: a server fault |
| `forbidden` | 403 | the Role is below the operation's rung: a server fault, the web app checked first |
| `unknown_operation` | 404 | not ported. The web app forwards only what `RUST_OPERATIONS` in `remote.ts` lists, so this means the two disagree |
| `cross_org` | 403 | reconstructs the org-pinned Db refusal on Suggested Fix dismissal |
| `internal` | 500 | a database error, logged here, never described to the caller |

`GET /healthz` answers `ok` without touching the database. `GET /v1/ops` lists
`[{"name", "role"}]`, the operations this build runs and the least Role each
needs; it is what the parity test compares with the TypeScript side.

### The assertion

`base64url(claims) + "." + base64url(HMAC-SHA256(secret, base64url(claims)))`,
where the claims are:

```json
{ "op": "alerts.resolve", "org": "<uuid>", "sub": "<member uuid>", "email": "<member email or null>",
  "role": "editor", "scope": "session", "body": "<base64url sha256 of the body>", "exp": 1792000000 }
```

The signer is `signAssertion` in `packages/ops/src/remote.ts` (Web Crypto), the
verifier `src/assertion.rs`. An assertion names one operation and the exact
body bytes, lives 30 seconds and is refused past 60. Changing the body, even
its whitespace, invalidates it.

### The two scopes

- `session` is the console. The transaction runs as `authenticated` with the
  Member's claims in `request.jwt.claims`, so RLS decides exactly as it does
  through PostgREST. Those claims are `sub`, `role` (`authenticated`), `aud`
  (`authenticated`) and `email` when the web app knows it. A Member's real JWT
  carries more (`app_metadata`, `user_metadata`, `session_id`, `aal`, ...),
  which this service never sets. No policy reads them today, and `cargo test`
  fails when a migration under `supabase/migrations` or `ee/migrations` reads a
  claim outside that list, through `auth.jwt()`, `auth.email()` or the
  `request.jwt.claim` settings.
- `pinned` is an API key. The transaction runs as `service_role`, and every
  query filters on the assertion's organization, which is what `createOrgPinnedDb`
  does on the TypeScript side.

Both use `set local`, so nothing outlives the transaction on a pooled
connection.

Alerts and Improvements list reads stop at 1000 rows (`rows::POSTGREST_MAX_ROWS`), matching PostgREST’s `max_rows` in `supabase/config.toml`. Task Labels use the generic Db accessor, which pages every row; their port returns the complete list. Tests pin both behaviors.

## Running it

```sh
cargo run --manifest-path services/ciele-api/Cargo.toml
```

| Variable | Default | |
|---|---|---|
| `DATABASE_URL` | required | direct Postgres or a session-mode pooler, see RUNBOOK |
| `CIELE_RUST_API_SECRET` | required | at least 32 bytes, the same value `apps/web` has |
| `DATABASE_MAX_CONNECTIONS` | 10 | |
| `HOST`, `PORT` | `127.0.0.1`, `8080` | set `HOST=0.0.0.0` in a container |
| `RUST_LOG` | `info` | JSON logs on stdout |

Then in `apps/web`: `CIELE_RUST_API_URL`, the same `CIELE_RUST_API_SECRET`, and
`CIELE_RUST_OPERATIONS=alerts.list,alerts.resolve,alerts.update`.

## Tests

- `cargo test`: the assertion, input validation, the refusals that happen
  before any query, the row cap and the JWT claims migrations read.
- `packages/ops/src/rust-parity.test.ts`: the same operations run through
  TypeScript and through this binary against one schema-loaded PGlite, and the
  answers must match. For every operation in `OPERATIONS` it also checks the
  Role against the TypeScript capability and this README, sends malformed
  inputs past zod and expects the same verdict, and reads another
  Organization's rows in both scopes. It needs the binary:

  ```sh
  cargo build --manifest-path services/ciele-api/Cargo.toml
  CIELE_RUST_PARITY_REQUIRED=1 CIELE_RUST_API_BIN=$PWD/services/ciele-api/target/debug/ciele-api \
    pnpm --filter @ciele/ops exec vitest run rust-parity
  ```

  Without `CIELE_RUST_API_BIN` it skips, unless `CIELE_RUST_PARITY_REQUIRED=1`,
  which makes a missing binary a failure.

`.github/workflows/rust.yml` runs both, plus `cargo fmt` and `clippy`.
`pnpm verify` runs both through `scripts/verify-rust.sh`, and fails without
cargo unless `CIELE_SKIP_RUST=1`.

## Porting the next operation

1. Add a row to `OPERATIONS` in `src/lib.rs`, with the body in a module named
   after its domain, and its name to `RUST_OPERATIONS` in
   `packages/ops/src/remote.ts`.
2. Return what the TypeScript body returns. Rows leave Postgres through
   `to_jsonb` and [`rows::camelize`](src/rows.rs), the same rename as
   `rowToDomain`. A list read stops at `rows::POSTGREST_MAX_ROWS`.
3. Add its entry to `PORTS` in the parity test (another Organization's rows,
   malformed inputs) and its behaviour cases, mutations on twin rows. The test
   fails until the entry exists.
4. Add its row to the table at the top of this file.
5. List it in `CIELE_RUST_OPERATIONS` where you want it to run.

An operation that needs `ctx.ports` cannot move until its port has a Rust
side, and the parity test fails a case whose TypeScript body reaches one. One
a Teammate or an agent author can run still runs in TypeScript on those paths,
because `remote.ts` never forwards them.
