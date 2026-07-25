# Durable job layer: Supabase ledger plus Vercel cron

## Status

Accepted.

## Context

Ciele currently starts knowledge ingestion with Next.js `after()` and finalizes
website crawls through client polling plus one protected Vercel Cron endpoint.
This is responsive, but `after()` is not a durable job queue: it schedules work
after the response, while the durable state lives only in our Source status.

The product requirement is modest but load-bearing: each website Source needs a
re-crawl schedule of `daily`, `weekly`, `monthly`, or `never`, plus manual
relaunch. The 12-18 month sizing horizon is 1-5 organizations, with an
infrastructure budget under EUR25/month excluding LLM tokens.

Relevant platform facts:

- Vercel Cron on Hobby is constrained to once-daily schedules; that matches the
  most frequent product schedule. Source:
  https://vercel.com/docs/cron-jobs/usage-and-pricing
- Next.js `after()` is a post-response hook for side effects, useful for
  responsiveness but not a durable queue abstraction. Source:
  https://nextjs.org/docs/app/api-reference/functions/after
- Supabase Cron can schedule Postgres jobs from every second to once a year.
  Source: https://supabase.com/docs/guides/cron
- Supabase Queues is Postgres-native durable messaging with guaranteed
  delivery, but still needs a worker/drainer in our app architecture. Source:
  https://supabase.com/docs/guides/queues
- Supabase Edge Functions add another runtime and have Free-plan wall-clock and
  CPU limits, making them a poor first worker for LLM/file ingestion. Source:
  https://supabase.com/docs/guides/functions/limits
- External workflow products fit the problem but are unnecessary at this scale:
  QStash free tier is limited but usable, Inngest and Trigger.dev have generous
  free tiers, yet all add another operational surface before Ciele has evidence
  Vercel + Supabase do not fit. Sources:
  https://upstash.com/pricing/qstash,
  https://www.inngest.com/pricing,
  https://trigger.dev/pricing

## Decision

Use Supabase Postgres as the durable job ledger and keep Vercel Cron as the
single orchestrator/backstop for this phase.

The runtime shape:

- Add a first-party `background_jobs` table for durable work items such as
  `ingest_source`, `finalize_crawl`, and `recrawl_source`.
- Add schedule fields to website Source config or a normalized schedule table:
  `recrawlSchedule` (`daily`/`weekly`/`monthly`/`never`), `nextRecrawlAt`,
  `lastRecrawlAt`, and room for future per-page override inheritance.
- Manual relaunch inserts a durable job immediately and may also invoke the
  existing `after()` fast path. The job row is the source of truth; `after()` is
  only acceleration.
- The daily Vercel Cron scans due schedules and stale/runnable jobs, claims a
  bounded batch, and runs them through the same existing ingestion/crawl
  functions.
- Failures update the job attempt/error fields, preserve the Source `error`
  state, and raise/refresh an `Alert` keyed to the Source/job. A later success
  auto-resolves the alert.

## Rejected Options

- **Only status quo `after()` + cron sweep**: cheap, but ingestion can still be
  lost on instance recycle because there is no durable job row to retry.
- **Supabase pg_cron + pg_net/Edge Functions now**: viable later, but it splits
  worker code into Deno or SQL-triggered HTTP before the app has outgrown one
  Vercel daily orchestrator.
- **Supabase Queues now**: good future adapter, but a queue still needs a worker
  process. At current scale a plain job ledger is easier to inspect, migrate and
  operate.
- **QStash/Inngest/Trigger.dev now**: technically strong, but adds a third
  platform before there is evidence that Vercel + Supabase fail the workload or
  budget.

## Consequences

- The first implementation is mostly data-model and adapter work, not new
  infrastructure.
- Daily/weekly/monthly schedules are all satisfiable on Vercel Hobby because
  daily is the highest required cadence.
- Manual relaunch can stay responsive while still being recoverable.
- If Ciele later needs sub-daily schedules, high concurrency, or richer retries,
  the `background_jobs` adapter can move to Supabase Queues, Supabase Cron, or a
  third-party workflow system without changing product-level schedule semantics.
