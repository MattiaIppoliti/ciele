# ciele-api runbook

## Turning it off

Unset `CIELE_RUST_OPERATIONS` in `apps/web` (or remove one name from it) and
restart the web app. Every operation runs in TypeScript again. The service
itself can stay up or go down; nothing reaches it once no operation names it.

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
burst of instances under the pooler's limit). The web project's
`CIELE_RUST_API_URL` and the service's own deployment must come from the same
commit: the assertion format is part of the contract.

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
