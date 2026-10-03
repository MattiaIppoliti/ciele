# Application diagnostics at execution seams

## Status

Accepted.

## Context

The architecture already separates pure domain rules (`core`), data access
(`db`), operations (`ops`) and the framework-free agent runtime (`agent`).
HTTP, console and agent callers authorize differently by design. Teammate
grants can authorize a write that the invoking Member's Role cannot perform.
Combining those policies in a generic executor would change product behavior.

The missing shared foundation is application diagnostics. Operations have no
lifecycle log. Cron authentication returns failures without diagnostics.
Idempotency catches storage and execution errors, so Next's error hook never
sees them. Runtime accounting and telemetry failures print raw exceptions.
Diagnosing one request across these modules requires unrelated log formats.

## Decision and scope

Add `@agent-hub/diagnostics`, a Node-only module with no runtime dependencies.
Its interface observes work, scopes diagnostic context, reports failures and
selects a bounded request identifier. It uses async-local context, rather than
a mutable process-wide request context, so concurrent tenants stay isolated.

- Observe `Operation.run` once in `defineOperation`. Every caller gets the
  same lifecycle record. Keep validation and authorization in their adapters.
- Observe API operation admission and cron handlers, including refused calls.
- Report caught idempotency failures without altering claims or replay rules.
- Report uncaught Node server errors through the web app's Next `onRequestError`
  hook. Keep Node-only imports out of edge runtimes.
- Observe chat and trigger dispatch in the Widget, Preview and internal agent
  routes. Leave streaming body ownership with the existing runtime.
- Observe durable job execution and preserve retry, lease and settlement rules.
- Use the same safe failure record for runtime telemetry, usage and capacity
  fallbacks. A diagnostic sink failure must never change the work's result,
  thrown value, response, retry or cache invalidation.

Emit one JSON record per lifecycle transition to the host's runtime logs.
Context has a fixed allow-list of identifiers, route templates, surface names
and counts. Log error classes, never raw exceptions, messages or stacks.
Do not log inputs, results, bodies, query strings, authorization headers,
idempotency keys or scope hashes. Timing measures the observed work; a returned
streaming response does not mean that its body has finished streaming.

These logs complement ADR-0011's retained `runtime_events` and user-facing
Alerts. They do not add a table, exporter, paid service or deployment setting.
Do not log in the browser or the CLI/MCP stdio transport. Insights Admin uses
the web app's host adapter and keeps its enterprise authorization boundary.
The upstream crawler worker stays separate.

## Verification

Verify through public interfaces: diagnostic observation and context scoping,
`Operation.run`, the API runner, cron authentication, idempotent mutations,
durable job draining, runtime event/usage writes and Next instrumentation.
Assert original results/errors, tenant isolation, safe metadata, honest
outcomes and sink failure isolation. Existing capability, cache, replay and
lease tests remain authoritative. Run workspace checks and mirror verification.

## Consequences

Adding an operation or cron route automatically adds diagnostics. Runtime
failures and operation lifecycles use one contract without importing Next into
shared packages or adding I/O to `core`. No client-visible behavior changes.
Diagnostic request correlation is local to an invocation; durable job IDs
link separate invocations. It is not a distributed OpenTelemetry exporter.

References: [Next instrumentation](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation),
[Vercel runtime logs](https://vercel.com/docs/logs/runtime), ADR-0011, ADR-0018,
ADR-0019 and ADR-0020.
