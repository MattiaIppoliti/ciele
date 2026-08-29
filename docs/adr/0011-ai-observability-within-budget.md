# AI observability within budget: OTel plus Supabase events

## Status

Accepted.

## Context

Ciele has user-visible operational Alerts for provider and crawl failures, but
it does not yet have systematic visibility over LLM latency, token usage, tool
calls, retrieval steps, ingestion job failures, or cron sweeps. That evidence is
needed before moving workloads away from Vercel/Supabase.

The Vercel AI SDK exposes experimental OpenTelemetry telemetry on individual
`generateText`/`streamText` calls, including stream timing, tool-call spans, and
token usage. Next.js supports OpenTelemetry instrumentation, and OpenTelemetry
keeps the instrumentation vendor-neutral. Langfuse Cloud has an LLM-specific
free tier, but self-hosting it would add infrastructure this map explicitly
tries to avoid. Sentry is valuable for application errors, but its paid
observability plans are not the first fit for LLM traces under the infra budget.

Sources:

- AI SDK telemetry:
  https://ai-sdk.dev/docs/ai-sdk-core/telemetry
- Next.js OpenTelemetry:
  https://nextjs.org/docs/app/guides/open-telemetry
- OpenTelemetry JavaScript:
  https://opentelemetry.io/docs/languages/js/
- Langfuse Cloud pricing:
  https://langfuse.com/pricing
- Langfuse self-host pricing:
  https://langfuse.com/pricing-self-host
- Sentry pricing:
  https://docs.sentry.io/pricing/

## Decision

Instrument the runtime with OpenTelemetry-compatible events, but make Supabase
the retained source of truth for budget-safe operational metrics.

Add a minimal `runtime_events` table in Supabase for structured, privacy-safe
events:

- `organization_id`, `assistant_id`, optional `conversation_id` and
  `message_id`;
- `kind` (`chat_turn`, `llm_step`, `tool_call`, `retrieval`, `ingest_job`,
  `cron_sweep`);
- `status` (`started`, `succeeded`, `failed`);
- timestamps and duration;
- provider, model, credential kind, flow id/name when relevant;
- token counts and cost estimate when the provider reports usage;
- tool/search counts, concept/read counts, and error class/message;
- opaque trace id/span id for joining with an external trace backend.

Do not store prompts, message text, retrieved chunks, model outputs, API keys,
or personal contact data in this table.

Enable AI SDK telemetry on the generative calls that already define runtime
boundaries:

- intent classification;
- search-knowledge `streamText`;
- OKF enrichment;
- embeddings, where provider usage is available.

Set `recordInputs: false` and `recordOutputs: false` by default. Attach only
metadata needed for debugging and rollups: organization id, assistant id,
conversation id, flow id, provider, model, credential kind, surface
(`preview`/`widget`), and source/job ids.

Use Langfuse Cloud as an optional trace viewer while it remains inside the free
tier or a consciously approved paid plan. Sampling and enablement must be
environment-controlled. Do not self-host Langfuse, SigNoz, or another
observability stack for this phase.

Alerts remain the human-actionable surface. `runtime_events` is telemetry; an
alert is raised only when a provider, crawl, or system issue needs admin action.

## Minimal Instrumentation

- Chat routes: turn started/succeeded/failed, total duration, model/provider,
  credential kind, flow, first-token/finish timing when available, token usage,
  tool-call count, retrieval count, and provider errors.
- Ingestion jobs: job started/succeeded/failed, source id, collection id,
  duration, concepts created, chunks embedded, embedding provider/model, and
  failure reason.
- Cron finalizers: sweep started/succeeded/failed, crawls inspected, crawls
  finalized, failures raised/resolved, and duration.
- Website crawls (`kind: 'crawl'`): one event per terminal outcome from the
  finalizer, resolved crawler provider, worker task/run correlation id
  (`trace_id`), wall-clock duration, usable page count, terminal status, and a
  sanitized error class (`RemoteCrawlFailure` / `EmptyCrawl` / the caught error
  class). The crawler token, `Authorization` header, and provider response
  bodies are redacted before any of this reaches a Source, an Alert, or the
  sink. Worker-side health and memory/concurrency signals (health probe,
  `/metrics`, queue depth, memory threshold) are monitored on the worker
  itself, see `services/crawl4ai-worker/RUNBOOK.md` §5; this sink carries only
  the per-crawl outcome.
- Provider health: keep the existing Alert path, but also emit a telemetry
  event so failures can be counted historically after an alert is resolved.

## Retention

Keep detailed runtime events for a short operational window first, such as
30 days, and roll up daily counts/latency/token/cost metrics before deleting
detail rows. Increase retention only if there is a concrete debugging need and
Supabase storage remains inside budget.

## Rejected Options

- **Plain `console.log` only**: cheap but not queryable, not durable, and hard
  to correlate with user-facing failures.
- **Sentry as the primary LLM observability tool**: useful for exceptions, but
  less aligned with token/tool/retrieval analysis and more likely to exceed the
  budget once tracing volume matters.
- **Langfuse self-hosted now**: feature-rich, but adds a service to operate.
- **Paid managed observability now**: premature without measured event volume.

## Consequences

- Ciele gets enough evidence to decide whether a workload truly outgrows
  Vercel/Supabase.
- The runtime gains token, latency, tool, retrieval, and job-failure history
  without storing sensitive chat content.
- External trace viewing stays optional and replaceable because the
  instrumentation is OpenTelemetry-shaped.
