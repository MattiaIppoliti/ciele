-- Retention for the inbound-Flow run ledger (#843).
--
-- `http_flow_runs` is written once per call to a published Flow endpoint and
-- read only as "the newest 20 for this Flow". No Conversation hangs off a run,
-- which is the point of it — an inbound call never enters the Inbox or the
-- Insights population — but it also means none of the retention that reaches
-- transcripts reaches this table, and nothing else ever removes a row. It is
-- coordination history, not product history, so it belongs with the other
-- runtime ledgers: one fixed window, no per-Organization knob, swept by the
-- same nightly drain.
--
-- 30 days, matching `background_jobs`: long enough to debug a caller's
-- integration the week after it broke, short enough that a chatty endpoint
-- cannot grow the table without limit.

create index if not exists http_flow_runs_retention_idx
  on public.http_flow_runs (created_at, id);

create or replace function public.sweep_runtime_ledgers(
  p_now timestamptz,
  p_limit integer
)
returns jsonb
language sql
volatile
security definer
set search_path = public
as $$
  with old_jobs as (
    delete from public.background_jobs
    where id in (
      select id from public.background_jobs
      where status in ('succeeded', 'failed')
        and updated_at < p_now - interval '30 days'
      order by updated_at, id limit greatest(0, least(p_limit, 5000))
    ) returning 1
  ), old_turns as (
    delete from public.conversation_turns
    where (conversation_id, request_id) in (
      select conversation_id, request_id from public.conversation_turns
      where status in ('completed', 'failed')
        and updated_at < p_now - interval '7 days'
      order by updated_at, conversation_id, request_id
      limit greatest(0, least(p_limit, 5000))
    ) returning 1
  ), old_effects as (
    delete from public.turn_effect_outbox
    where id in (
      select id from public.turn_effect_outbox
      where status in ('succeeded', 'failed')
        and updated_at < p_now - interval '30 days'
      order by updated_at, id limit greatest(0, least(p_limit, 5000))
    ) returning 1
  ), old_keys as (
    delete from public.api_idempotency_keys
    where (scope, idempotency_key) in (
      select scope, idempotency_key from public.api_idempotency_keys
      where expires_at <= p_now
      order by expires_at, scope, idempotency_key
      limit greatest(0, least(p_limit, 5000))
    ) returning 1
  ), old_http_flow_runs as (
    delete from public.http_flow_runs
    where id in (
      select id from public.http_flow_runs
      where created_at < p_now - interval '30 days'
      order by created_at, id limit greatest(0, least(p_limit, 5000))
    ) returning 1
  ), old_generations as (
    select c.source_id, c.generation_id
    from public.concepts c
    join public.sources s on s.id = c.source_id
    where c.source_id is not null
      and c.generation_id is not null
      and c.is_active = false
      and c.generation_id is distinct from s.active_generation_id
      and s.config->>'crawlIngestGenerationId' is distinct from c.generation_id::text
      and not exists (
        select 1
        from public.source_ingest_payloads sip
        join public.background_jobs j on j.source_id = sip.source_id
        where sip.source_id = c.source_id
          and sip.generation_id = c.generation_id
          and j.kind = 'ingest_source'
          and j.status in ('queued', 'running')
      )
    group by c.source_id, c.generation_id
    having max(c.created_at) < p_now - interval '24 hours'
    order by min(c.created_at), c.source_id, c.generation_id
    limit greatest(0, least(p_limit, 100))
  ), old_generation_concepts as (
    delete from public.concepts c
    using old_generations g
    where c.source_id = g.source_id and c.generation_id = g.generation_id
    returning c.id
  )
  select jsonb_build_object(
    'backgroundJobs', (select count(*) from old_jobs),
    'conversationTurns', (select count(*) from old_turns),
    'turnEffects', (select count(*) from old_effects),
    'apiIdempotencyKeys', (select count(*) from old_keys),
    'httpFlowRuns', (select count(*) from old_http_flow_runs),
    'sourceGenerations', (select count(*) from old_generations)
  );
$$;

revoke all on function public.sweep_runtime_ledgers(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.sweep_runtime_ledgers(timestamptz, integer)
  to service_role;
