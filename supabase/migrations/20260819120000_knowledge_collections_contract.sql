-- Knowledge collections contract (PRD #726, ticket #733, the follow-up
-- 20260818090000_knowledge_contract_columns deferred): Collections stop
-- belonging to an Assistant. `knowledge_collections.assistant_id` drops, and
-- with it every policy and RPC that still read it. "An Assistant's
-- collections" is derived from the assistant↔source link table from here on.
-- Idempotent throughout; ordered strictly after the #728/#733 backfills, which
-- guarantee every Source is linked and every chunk carries its Source.

-- 0. Belt: any Collection the backfills missed (none expected) learns its org
--    before the column that carries the derivation disappears. Guarded so a
--    re-run (column already gone) stays a no-op.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'knowledge_collections'
      and column_name = 'assistant_id'
  ) then
    update public.knowledge_collections kc
    set organization_id = a.organization_id
    from public.assistants a
    where a.id = kc.assistant_id
      and kc.organization_id is null;
  end if;
end $$;

-- 1. Claim RPCs stop reading kc.assistant_id: the ingestion pipeline's usage
--    attribution derives its assistant from the earliest link instead ('' when
--    an admin unlinked everything, ingest already tolerates an unresolvable
--    assistant and logs the unattributed run).
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
  from candidates c
  where s.id = c.id
  returning
    s.id,
    s.collection_id,
    coalesce(
      (select l.assistant_id from public.assistant_sources l
       where l.source_id = s.id
       order by l.created_at asc, l.assistant_id asc
       limit 1),
      ''
    );
end;
$$;

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
  from candidates c
  where s.id = c.id
  returning
    s.id,
    s.collection_id,
    coalesce(
      (select l.assistant_id from public.assistant_sources l
       where l.source_id = s.id
       order by l.created_at asc, l.assistant_id asc
       limit 1),
      ''
    );
end;
$$;

-- 2. Every assistant-routed RLS policy goes; the org-routed ones from the
--    expand (member read, editor write) are the only path now.
--    0005's originals:
drop policy if exists "members all collections" on public.knowledge_collections;
drop policy if exists "members read collections" on public.knowledge_collections;
drop policy if exists "members all sources" on public.sources;
drop policy if exists "members all concepts" on public.concepts;
--    0017/0025's per-verb collection policies (superseded by the expand's
--    org-routed "editors write org collections"):
drop policy if exists "editors insert collections" on public.knowledge_collections;
drop policy if exists "editors update collections" on public.knowledge_collections;
drop policy if exists "editors delete collections" on public.knowledge_collections;

-- 3. 0041's background-job policies re-route through the Collection's org.
drop policy if exists "members read source jobs" on public.background_jobs;
create policy "members read source jobs" on public.background_jobs
  for select using (exists (
    select 1
    from public.sources s
    join public.knowledge_collections kc on kc.id = s.collection_id
    where s.id = background_jobs.source_id
      and kc.organization_id is not null
      and private.is_org_member(kc.organization_id)
  ));

drop policy if exists "editors create source jobs" on public.background_jobs;
create policy "editors create source jobs" on public.background_jobs
  for insert with check (exists (
    select 1
    from public.sources s
    join public.knowledge_collections kc on kc.id = s.collection_id
    where s.id = background_jobs.source_id
      and kc.organization_id is not null
      and private.has_org_role(kc.organization_id, 2)
  ));

drop policy if exists "editors update source jobs" on public.background_jobs;
create policy "editors update source jobs" on public.background_jobs
  for update using (exists (
    select 1
    from public.sources s
    join public.knowledge_collections kc on kc.id = s.collection_id
    where s.id = background_jobs.source_id
      and kc.organization_id is not null
      and private.has_org_role(kc.organization_id, 2)
  ))
  with check (exists (
    select 1
    from public.sources s
    join public.knowledge_collections kc on kc.id = s.collection_id
    where s.id = background_jobs.source_id
      and kc.organization_id is not null
      and private.has_org_role(kc.organization_id, 2)
  ));

-- 4. The expand's link-table write policy loses its legacy owner-assistant
--    fallback: post-backfill every Collection carries its org id.
drop policy if exists "editors write assistant sources" on public.assistant_sources;
create policy "editors write assistant sources" on public.assistant_sources
  for all using (exists (
    select 1 from public.assistants a
    where a.id = assistant_sources.assistant_id
      and private.has_org_role(a.organization_id, 2)
  ))
  with check (exists (
    select 1
    from public.assistants a, public.sources s
    join public.knowledge_collections kc on kc.id = s.collection_id
    where a.id = assistant_sources.assistant_id
      and s.id = assistant_sources.source_id
      and private.has_org_role(a.organization_id, 2)
      and kc.organization_id = a.organization_id
  ));

-- 5. The column itself (its index drops with it). `cascade` because a
--    deployment may carry a view that still reads the column to reach the
--    Organization; Postgres refuses a plain drop in that case (2BP01) and the
--    whole migration rolls back, which is how this shipped un-appliable. The
--    enterprise chain, applied right after this one in the same run, recreates
--    what cascade takes with it; an open-source database has no dependents and
--    sees no difference.
alter table public.knowledge_collections drop column if exists assistant_id cascade;
