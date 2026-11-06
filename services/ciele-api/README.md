# ciele-api

The Rust half of the backend rewrite (map #1111, first slice #1121). It runs
operations from `@ciele/ops`, one domain at a time, against the same Postgres
and under the same row-level security as the TypeScript body it replaces.

It has two doors:

- `POST /v1/ops/{operation}`, the forwarding seam. `apps/web` authenticates
  the caller, checks the operation's capability and validates the input. Then,
  for an operation named in `CIELE_RUST_OPERATIONS`, `defineOperation` posts
  the parsed input here instead of running it in-process. This is how the
  console reaches the service.
- `/api/v1/...`, for the endpoints whose route runs one ported operation
  (#1134). Here the service is the front door: it verifies the Organization API
  key itself and answers exactly as the route handler would. See
  [Serving /api/v1](#serving-apiv1).
- `/api/mcp`, the hosted MCP endpoint (#1135). See
  [Serving /api/mcp](#serving-apimcp).

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

## The widget endpoints

A second surface, separate from `/v1/ops` (#1136). The service mounts the
public widget routes at the paths the widget already calls,
`/api/widget/{assistantId}/…`, and answers them in full: CORS from the
Publication's allowed domains, the sealed SSO gate cookie, and the body the
Next.js route would send. There is no assertion, because these routes are
public in the web app too. Queries run on a second pool whose connections
`set role service_role`, the role the web app's widget Db uses.

| Endpoint | Next.js original |
|---|---|
| `config` | `apps/web/src/app/api/widget/[assistantId]/config/route.ts` |
| `session` | `apps/web/src/app/api/widget/[assistantId]/session/route.ts` |
| `feedback` | `…/feedback/route.ts` |
| `conversation-feedback` | `…/conversation-feedback/route.ts` |
| `conversations` | `…/conversations/route.ts` |
| `help-desks` | `…/help-desks/route.ts`, projected as `apps/web/src/lib/escalation-desks.ts` does |
| `memories` | `…/memories/route.ts`, `GET` and `DELETE` |
| `sources` | `…/sources/[sourceId]/download/route.ts` and `apps/web/src/lib/storage/deliver-object.ts` |

`GET /v1/widget` lists them. `RUST_WIDGET_ROUTES` in
`apps/web/src/lib/rust-routing.ts` must name the same list, and
`apps/web/src/app/api/widget/rust-parity.test.ts` checks that and compares
every answer with the route's (recorded in `__golden__/rust-parity.json`).

**Kept in Next.js**, because a side effect they need has no Rust side yet
(listed on #1122):

| Endpoint | What it needs |
|---|---|
| `escalation` | the email transport (`sendEmail`), the egress-guarded API channel request (`sendEscalationApiRequest`), and the Suggested Fix job (`enqueueDraftProposalJob` plus its after-response drain) |
| `trigger` | a Conversation Turn (`streamConversationTurn`: Notification rendering, session state, runtime events) and the enterprise activation check |
| `attachments` | document parsing and the vision model (`extractSourceText`, `createVisionReader`) and the attachment sealing the chat route opens |
| `voice` | a voice provider |
| `chat` | the turn runtime |

**Routing.** `apps/web`'s middleware rewrites a request to the same path here
when `CIELE_RUST_API_URL` is set and `CIELE_RUST_WIDGET_ROUTES` names the
endpoint (for example `config,session,feedback`). Unset, the Next.js route answers. The decision is
`rustRewrite` in `apps/web/src/lib/rust-routing.ts`, the one module that
routes every surface (`/api/v1`, `/api/mcp`, the widget), reads each variable
by name and joins every service URL the same way. On Vercel the same can be
done at the edge with `vercel.rewrites.json`, which carries the widget paths
too and is prepared, not deployed.

**The Publication cache.** Every request asks Postgres which Publication is
latest, and the query sends the snapshot only when it is not the one already
held (`src/widget/publication.rs`). A new Publication is therefore served on
the next request on every instance, with no TTL and no invalidation message;
what the cache saves is the snapshot crossing the wire and being parsed.

This is a deliberate trade-off against #1136, which asked for no Postgres at
all on a repeat load. A load still costs one small query (the latest
Publication's id), in exchange for never serving a superseded Publication and
needing no invalidation between instances. Holding the id for a TTL would
remove that query and bring back a window in which a republished Assistant
shows its old launcher.

Every read that names a Conversation or a message checks it belongs to this
Assistant and to the subject the request speaks for (the SSO gate's, or the
Visitor id's), as `subjectOwnsConversation` does.

The model picker reads provider connections live, as the route does, and only
when the Assistant offers more than one model.

**The model picker** follows `chatModelOptions` in `packages/agent`. Its static
data is `src/widget/model_catalog.json`, which
`packages/agent/src/rust-model-catalog.test.ts` holds to the TypeScript
constants.

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

`improvements.listPage` carries the board's storage filters (search, status,
priority, assignee, Project, Assistant) and per-stage `counts`. A filtered read
goes through `public.matching_improvements`, the SQL predicate both TypeScript
adapters use, so it needs migration `20261103101154_answer_improvement_workflow`;
an unfiltered read does not. `GET /api/v1/improvements` without filters is still
one direct statement; with any filter parameter it runs the operation.

Alerts and Improvements list reads stop at 1000 rows (`rows::POSTGREST_MAX_ROWS`), matching PostgREST’s `max_rows` in `supabase/config.toml`. Task Labels use the generic Db accessor, which pages every row; their port returns the complete list. Tests pin both behaviors.

## Serving /api/v1

`ENDPOINTS` in `src/v1.rs`: today `GET /alerts`, `POST /alerts/{id}/resolve`,
`GET /improvements`, `GET` and `POST /task-labels`, `PATCH` and
`DELETE /task-labels/{id}`. `GET /v1/routes` lists them.

The request runs the route's steps in the route's order: the route's own body
check (`400 Body must be JSON`) or list parameters, then the key
(`src/api_key.rs`: bearer header, SHA-256 lookup, revoked key or departed
creator refused, the key capped at its creator's current Role, `last_used_at`
stamped), then the Role (`403`), then zod's first issue (`422`, worded as zod
words it, `src/zod.rs`), then the operation in the `pinned` scope. Error bodies
are byte for byte the route's. Two differences, both deliberate:

- a database failure answers `500 {"error":{"code":"internal",...}}`, where
  Next.js answers a bare 500;
- a write skips all of `revalidateEntities`, not only the Find caches: no
  `revalidatePath` for `/alerts` after a resolve, none for `/projects`,
  `/my-tasks` or `/tasks` after a Label write. A Member with one of those
  pages open sees the old rows until a reload, and the Find palette can show
  a renamed Label's old name for up to 30 seconds.

Two operational facts follow from skipping the route handler. With the
service configured but down, a routed path fails: nothing falls back to the
route handler, and the recovery is unsetting the routing variables
(`CIELE_RUST_OPERATIONS`, or `CIELE_RUST_API_URL`) and restarting `apps/web`.
And `vercel.rewrites.json` reads neither `CIELE_RUST_OPERATIONS` nor
`CIELE_RUST_MCP`, so once it is merged, turning a path off there is a
redeploy, not a variable.

Who sends requests here: the web app's middleware, when the service is
configured (`CIELE_RUST_API_URL`, `CIELE_RUST_API_SECRET`) and the endpoint's
operation is in `CIELE_RUST_OPERATIONS`. The list it routes is
`RUST_DIRECT_ENDPOINTS` in `apps/web/src/lib/rust-routing.ts`;
`rust-routing.test.ts` derives it from the route files and `RUST_OPERATIONS`,
and the `/api/v1` parity test holds it to `GET /v1/routes`. Porting an
operation whose `/api/v1` route exists fails that test until the endpoint is
in both lists.

`vercel.rewrites.json` is the same routing for Vercel, prepared and not
deployed (RUNBOOK, "Rewrites on Vercel"). It carries `/api/mcp` too.

## Serving /api/mcp

`src/mcp.rs` on rmcp's stateless Streamable HTTP server: the 2026-07-28
revision (`server/discover`, per-request `_meta`) and the 2025 era
(`initialize`) from one handler, as `createMcpHandler` serves them in
`apps/web/src/app/api/mcp/route.ts`.

- **The door.** A POST without a valid key gets the `/api/v1` 401 before any
  MCP parsing; GET and DELETE get the SDK's 405. rmcp wants an
  `MCP-Protocol-Version` header whenever a body's `_meta` names a revision and
  the TypeScript SDK does not, so the door copies a missing one from the body.
- **The tool list** is `packages/mcp/golden/tools-list.json` (and
  `tools-list.read-only.json` under `CIELE_MCP_READ_ONLY=1`), recorded from
  the TypeScript server by `tools-list.golden.test.ts` and embedded at build
  time. Change a tool in `packages/mcp`, re-record
  (`CIELE_MCP_GOLDEN=update pnpm --filter @ciele/mcp exec vitest run tools-list.golden`)
  and rebuild.
- **Arguments** are checked against those schemas with the SDK's wording
  (`src/mcp_schema.rs`); **calls** are `src/mcp_tools/` (one module per tool), the port of
  `packages/mcp/src/tools.ts` and the client methods it calls. A request for an
  endpoint in `ENDPOINTS` runs in-process through its `/api/v1` handler and
  makes no request at all; every other one goes to `CIELE_MCP_API_ORIGIN` with
  the caller's key (`src/mcp_api.rs`), connecting within 10 s and answering
  within `CIELE_MCP_API_TIMEOUT_MS`. A refused connection fails the tool with
  undici's `fetch failed`, a timeout with its own message.
- `apps/web/src/app/api/mcp/rust-mcp.parity.test.ts` drives both servers with
  every action of every tool and compares the answers and the requests that
  reached the web app.

The web app's middleware sends `/api/mcp` here when `CIELE_RUST_MCP=1` and the
service is configured; otherwise the TypeScript endpoint serves it. The same
two facts as for `/api/v1` hold: a ported write run in-process skips
`revalidateEntities`, and with the service down `/api/mcp` fails rather than
falling back (recovery: `CIELE_RUST_MCP=0` and restart `apps/web`).

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
| `CIELE_MCP_API_ORIGIN` | unset | the web app, where an unported MCP tool call goes; unset, every `/api/mcp` POST answers 503 and startup logs an error |
| `CIELE_MCP_API_TIMEOUT_MS` | `290000` | the most one of those calls may take, body included; under the 300 s the TypeScript route allows an MCP request |
| `CIELE_MCP_READ_ONLY` | off | `1`: the read-only tool list, and every write refused before a request leaves |
| `CIELE_RUST_OPERATIONS` | every ported operation | which ported operations an MCP call runs in-process; the rest go to the web app |
| `WIDGET_DATABASE_MAX_CONNECTIONS` | `DATABASE_MAX_CONNECTIONS` | the widget pool, opened on the first widget request |
| `APP_ENCRYPTION_KEY`, `APP_ENCRYPTION_KEY_PREVIOUS` | unset | the web app's values: they open the SSO gate cookie and provider keys. Unset, every Visitor is anonymous |
| `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`), `SUPABASE_SERVICE_ROLE_KEY` | unset | object storage for Source downloads. Unset, a Direct access download answers 404, as the web app does without storage |
| `GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `AI_GATEWAY_API_KEY`, `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_CHAT_MODEL` | unset | read only for whether they are set, to draw the same model picker as the web app |

Then in `apps/web`: `CIELE_RUST_API_URL`, the same `CIELE_RUST_API_SECRET`, and
`CIELE_RUST_OPERATIONS=alerts.list,alerts.resolve,alerts.update`.

Self-host: `./deploy/bootstrap.sh --rust` adds `deploy/docker-compose.rust.yml`,
which builds this directory (`Dockerfile`) and lists every ported operation.

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

- `apps/web/src/lib/api-v1/rust-direct.parity.test.ts`: the same `/api/v1`
  requests through the route handlers and through this binary, statuses and
  error bodies compared byte for byte. Same two variables:

  ```sh
  CIELE_RUST_PARITY_REQUIRED=1 CIELE_RUST_API_BIN=$PWD/services/ciele-api/target/debug/ciele-api \
    pnpm --filter @agent-hub/web exec vitest run rust-direct.parity
  ```

- `rust-direct.latency.test.ts` next to it measures `GET /api/v1/alerts`
  through the route handler, the forwarding seam and this binary, with
  `CIELE_RUST_BENCH=1`. It is a measurement and gates nothing.

`.github/workflows/rust.yml` runs all three gates, plus `cargo fmt` and `clippy`.
`pnpm verify` runs them through `scripts/verify-rust.sh`, and fails without
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
