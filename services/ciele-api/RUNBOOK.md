# ciele-api runbook

## Turning it off

Unset `CIELE_RUST_OPERATIONS` in `apps/web` (or remove one name from it) and
restart the web app. Every operation runs in TypeScript again. The service
itself can stay up or go down; nothing reaches it once no operation names it.

Unsetting it also sends the `/api/v1` endpoints those operations serve back
to the route handlers: the middleware routes an endpoint to the service only
while its operation is on the list. On self-host, list fewer names in
`deploy/.env` (an empty value means every ported operation) or take
`docker-compose.rust.yml` off `COMPOSE_FILE`.

The hosted MCP endpoint has its own switch: set `CIELE_RUST_MCP=0` (or unset
it) in `apps/web` and restart, and `/api/mcp` is the TypeScript endpoint
again. On self-host it defaults to on while the overlay is listed.

## Widget endpoints

Unset `CIELE_RUST_WIDGET_ROUTES` in `apps/web` (or remove a name from it) and
restart the web app: the Next.js routes answer again. If the rewrite lives in
`vercel.json` instead (the widget paths of `vercel.rewrites.json`), remove the
entry and redeploy: the rewrites do not read `CIELE_RUST_WIDGET_ROUTES`. Like operations, a listed widget endpoint fails while the service
is down: the widget shows its error state, there is no fallback.

The service must have the web app's `APP_ENCRYPTION_KEY` (and
`APP_ENCRYPTION_KEY_PREVIOUS` during a rotation). Without it the SSO gate
cookie never opens, so a signed-in Visitor of an Assistant that requires
sign-in is asked to sign in again. It must also have the same platform model
keys set (only their presence is read), or the widget's model picker offers
a different list.

| Symptom | Cause | Fix |
|---|---|---|
| Widget shows "sign in" after a successful sign-in | `APP_ENCRYPTION_KEY` differs or is unset on the service | set the web app's value |
| `widget database error` in the service log, widget 500 | a query failed; `permission denied` means `DATABASE_URL`'s role cannot `set role service_role` | see "Database connection" |
| Every Source download is a 404 and the ledger shows no `failed` row | the service has no `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` | set both, the web app's values |
| Source downloads are a 404 with a `failed` ledger row | storage refused the signing call or the object is gone | check the key and the object in the `knowledge-originals` bucket |
| A republished Assistant still shows the old launcher | the browser's or a CDN's copy: `config` is `max-age=300`, as from Next.js. The service itself never serves an old Publication | wait five minutes |

## When the service is down

There is no automatic fallback (#1119). While `CIELE_RUST_OPERATIONS` names an
operation, every call to it goes to the service, and if the service is down,
unreachable or answering 5xx, the call fails: the console shows an error and
`/api/v1` answers 500. The web app does not retry in TypeScript, because a
write that timed out may still have committed on the service, and running it
again here could apply it twice.

Recovery is the switch above: unset `CIELE_RUST_OPERATIONS` (or drop the
affected names) and restart `apps/web`. Then fix the service.

A name in `CIELE_RUST_OPERATIONS` that this build of the web app cannot forward
(a typo, an operation not ported yet, one that needs a port) is not an outage:
the web app logs `[ciele-api] <names> cannot run in the Rust service; running
in TypeScript instead.` at startup and keeps running it here.

The `/api/v1` endpoints the middleware routes here fail the same way, with no
fallback: the middleware's proxy answers an error and the route handler never
runs. Recovery: unset the routing variables (`CIELE_RUST_OPERATIONS`, or
`CIELE_RUST_API_URL` to route nothing) and restart `apps/web`.

A write answered here also skips the route's `revalidateEntities`: the Find
caches and the `revalidatePath` calls for `/alerts`, `/projects`, `/my-tasks`
and `/tasks`. A Member who reports a stale page after an API write is seeing
that; a reload clears it.

## Deploying on Vercel

On Vercel the service is a Rust Function, `api/ops.rs`, which serves the
self-host binary's router through `vercel_runtime`'s axum layer. `vercel.json`
rewrites every path to it, in `fra1`, the web app's region. Deploy from a
clean export of a commit, never from a working tree, so what runs is what was
reviewed:

```sh
git archive <commit> services/ciele-api | tar -x -C /tmp/ciele-api --strip-components=2
cd /tmp/ciele-api && vercel link --project <rust project> && vercel deploy --prod
```

Not a container. Vercel's container runtime serves one request per instance,
and after any request lasting more than a few milliseconds it held the next
one for about a second: back-to-back `alerts.list` calls took ~1 s each while
the handler ran in 37 ms, and a handler that only slept 40 ms did the same.
As a Function the same calls take 0.16 to 0.32 s from a laptop.

The project needs, for each environment it serves: `DATABASE_URL` (the
Supabase session pooler, see below), `CIELE_RUST_API_SECRET` (the same value
as the web project's) and `DATABASE_MAX_CONNECTIONS` (3 per instance keeps a
burst of instances under the pooler's limit). To serve `/api/mcp` it also
needs `CIELE_MCP_API_ORIGIN`, the web project's origin: without it every MCP
POST answers 503 and the startup log says why. The web project's
`CIELE_RUST_API_URL` and the service's own deployment must come from the same
commit: the assertion format is part of the contract.

## Rewrites on Vercel

`vercel.rewrites.json` routes the directly served `/api/v1` paths, and
`/api/mcp`, to the service at the edge, with no function at all. The web project does not use it
yet (#1126). To turn it on, replace
`https://ciele-api.invalid` with the service's public origin and merge the
`rewrites` into `apps/web/vercel.json`. Two things to know first:

- a rewrite matches a path, not a method, so the file lists only paths whose
  every method the service answers (a test enforces it). An `OPTIONS` or
  `HEAD` on those paths reaches the service, which answers 405 where Next.js
  answers them itself;
- the rewrites ignore `CIELE_RUST_OPERATIONS` and `CIELE_RUST_MCP`, so the
  off switches above no longer cover those paths: turning one off is removing
  its rewrite and redeploying, not a variable;
- with the service down, a rewritten path fails at the edge. Nothing falls
  back to the route handler.

Until then the middleware does the routing on Vercel too, which costs a
middleware invocation but no route handler.

## Database connection

The service caches prepared statements per connection. A transaction-mode
pooler (Supavisor on port 6543, PgBouncer in transaction mode) hands the next
statement to a different backend, where the statement does not exist. Use one
of:

- the direct connection (`db.<ref>.supabase.co:5432`), or
- the session-mode pooler (port 5432 on the pooler host).

The role in `DATABASE_URL` must be able to `set role authenticated` and
`set role service_role`. On Supabase the `postgres` role can.

## Symptoms

| Symptom in apps/web | Cause | Fix |
|---|---|---|
| `ciele-api alerts.list failed: 401 unauthorized` | the two `CIELE_RUST_API_SECRET` values differ, or the clocks are more than 30 s apart | set the same secret on both; check NTP on the service host |
| `… failed: 404 unknown_operation` | the web app's `RUST_OPERATIONS` names an operation this build of the service does not have: the two were deployed from different commits | deploy both from one commit, or take the name off `CIELE_RUST_OPERATIONS` |
| `… failed: 500 internal` | a database error; the service logs it as `database error` | read the service log; a `prepared statement … does not exist` means a transaction pooler, see above |
| `/api/v1` answers 401 for every key, and only for ported endpoints | the service cannot read `organization_api_keys` as `service_role`, or points at another database | check `DATABASE_URL`; the role must be able to `set role service_role` |
| an MCP tool answers `CIELE_MCP_API_ORIGIN is not set, so this tool cannot reach /api/v1` | the service has no web app origin for unported tools | set `CIELE_MCP_API_ORIGIN` (self-host: `http://app:3000`, which the overlay sets) |
| an MCP client sees a tool the TypeScript server no longer lists, or misses a new one | the service was built before `packages/mcp/golden` was re-recorded | re-record the golden (README, "Serving /api/mcp"), rebuild and redeploy the service |
| fetch failed / timeout after 10 s | the service is down or unreachable | unset `CIELE_RUST_OPERATIONS`, restart `apps/web`, then fix the service (see above) |

## Rotating the secret

The web app signs with one secret and the service verifies with one, so a
rotation is a short outage for the listed operations unless they come off the
list first:

1. Remove the operations from `CIELE_RUST_OPERATIONS`, restart `apps/web`.
2. Set the new secret on both sides and restart both.
3. Put the operations back, restart `apps/web`.

Task Label reads, including the duplicate-name check, include every row, matching the generic Db accessor’s pagination beyond PostgREST’s 1000-row page.
The parity gate pins accepted colors, input boundaries and the public ID shape to TypeScript.

Suggested Fix propose/dismiss run here for Members; knowledge-writing acceptance and notification-bearing updates remain TypeScript. Pinned dismiss preserves the org-pinned Db refusal, including for a missing Improvement.
