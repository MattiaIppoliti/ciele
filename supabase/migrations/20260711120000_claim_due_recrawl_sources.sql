-- Scheduled re-crawl sweep (map ticket "Durable job layer"; issue #36).
--
-- Turns each Website Source's per-site cadence (daily / weekly / monthly;
-- "never" opts out) into hands-off refreshes. A daily cron (vercel.json)
-- claims the due Sources and hands them to the same wipe+recrawl pipeline the
-- manual re-crawl uses; this migration only supplies the atomic due-selection,
-- mirroring claim_processing_crawl_sources.
--
-- A Source is due when its last successful crawl is older than its cadence:
--   daily   -> last_crawled_at <= now - 1 day
--   weekly  -> last_crawled_at <= now - 7 days
--   monthly -> last_crawled_at <= now - 1 month
-- "never" and never-crawled Sources (last_crawled_at is null) are excluded.
-- This matches the pure next_crawl_due derivation the mock and UI share.
--
-- Claiming flips a due Source to `processing` and strips the previous run's
-- identity from config in one statement, so neither a second sweep (which
-- needs `ready`) nor the finalize sweep (which needs a crawlRunId) can touch a
-- claimed Source before its fresh crawl starts — running the sweep twice in a
-- window therefore never double-crawls, and a Source already crawling is
-- skipped. last_crawled_at is left untouched: it advances only when the new
-- crawl finalizes successfully, keeping next-due honest in the meantime.

create index if not exists sources_due_recrawl_idx
  on public.sources (recrawl_schedule, last_crawled_at)
  where status = 'ready'
    and kind in ('website', 'url')
    and recrawl_schedule <> 'never'
    and last_crawled_at is not null;

create or replace function public.claim_due_recrawl_sources(
  p_now timestamptz,
  p_limit integer
)
returns table (source_id text, collection_id text, assistant_id text)
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  with candidates as (
    select s.id
    from public.sources s
    where s.status = 'ready'
      and s.kind in ('website', 'url')
      and s.last_crawled_at is not null
      and (
        (s.recrawl_schedule = 'daily' and s.last_crawled_at <= p_now - interval '1 day')
        or (s.recrawl_schedule = 'weekly' and s.last_crawled_at <= p_now - interval '7 days')
        or (s.recrawl_schedule = 'monthly' and s.last_crawled_at <= p_now - interval '1 month')
      )
    order by s.last_crawled_at asc, s.created_at asc, s.id asc
    for update skip locked
    limit greatest(p_limit, 0)
  )
  update public.sources s
  set status = 'processing',
      error = '',
      config = coalesce(s.config, '{}'::jsonb)
        - 'crawlRunId' - 'crawlDatasetId' - 'resolvedCrawlerProvider',
      crawl_finalize_locked_at = null,
      crawl_finalize_locked_by = null
  from candidates c, public.knowledge_collections kc
  where s.id = c.id
    and kc.id = s.collection_id
  returning s.id, s.collection_id, kc.assistant_id;
end;
$$;
