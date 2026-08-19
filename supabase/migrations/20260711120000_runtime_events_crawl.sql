-- Crawl telemetry for the runtime_events sink (#108). The website-crawl
-- finalizer becomes the first non-chat writer: it meters one 'crawl' event per
-- terminal crawl outcome (success / remote failure / empty), carrying the
-- resolved crawler, the worker task/run correlation id (trace_id), duration,
-- usable page count, terminal status, and a sanitized error class, never the
-- crawler token, an Authorization header, or a provider response body.
--
-- Widens the `kind` vocabulary and adds two crawl-shaped columns; both are
-- nullable so existing rows and the chat/ingest/cron writers are unaffected.

alter table public.runtime_events
  drop constraint if exists runtime_events_kind_check;

alter table public.runtime_events
  add constraint runtime_events_kind_check
    check (kind in (
      'chat_turn', 'llm_step', 'tool_call', 'retrieval',
      'ingest_job', 'cron_sweep', 'crawl'
    ));

alter table public.runtime_events
  -- Resolved crawler for a 'crawl' event; null for every other kind.
  add column if not exists crawler_provider text
    check (crawler_provider is null
           or crawler_provider in ('local', 'apify', 'crawl4ai')),
  -- Usable pages a completed crawl ingested; null for non-crawl events.
  add column if not exists page_count integer;
