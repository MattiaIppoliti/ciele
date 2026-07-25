-- The cron finalizer pulls the least-recently-attempted pending crawl runs in
-- small batches. A short lease prevents a client poll and cron from ingesting
-- the same completed crawl concurrently.
alter table public.sources
  add column if not exists crawl_finalize_locked_at timestamptz,
  add column if not exists crawl_finalize_locked_by text,
  add column if not exists crawl_finalize_attempted_at timestamptz;

-- This partial index matches that queue query, avoiding a scan of every
-- Source whenever the admin has a large crawl backlog.
create index if not exists sources_pending_crawl_finalize_idx
  on public.sources (crawl_finalize_attempted_at nulls first, created_at, id)
  where status = 'processing'
    and kind in ('website', 'url')
    and (config ->> 'crawlRunId') is not null;

create or replace function public.claim_processing_crawl_sources(
  p_worker_id text,
  p_now timestamptz,
  p_stale_before timestamptz,
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
    where s.status = 'processing'
      and s.kind in ('website', 'url')
      and (s.config ->> 'crawlRunId') is not null
      and (s.crawl_finalize_locked_at is null or s.crawl_finalize_locked_at <= p_stale_before)
    order by s.crawl_finalize_attempted_at asc nulls first, s.created_at asc, s.id asc
    for update skip locked
    limit greatest(p_limit, 0)
  )
  update public.sources s
  set crawl_finalize_locked_at = p_now,
      crawl_finalize_locked_by = p_worker_id,
      crawl_finalize_attempted_at = p_now
  from candidates c, public.knowledge_collections kc
  where s.id = c.id
    and kc.id = s.collection_id
  returning s.id, s.collection_id, kc.assistant_id;
end;
$$;
