-- Internal coordination ledgers are not product history. Sweep terminal rows
-- in bounded batches so queue claims and restores do not grow without limit.
create index if not exists background_jobs_terminal_retention_idx
  on public.background_jobs (updated_at, id)
  where status in ('succeeded', 'failed');
create index if not exists turn_effect_outbox_terminal_retention_idx
  on public.turn_effect_outbox (updated_at, id)
  where status in ('succeeded', 'failed');
create index if not exists concepts_inactive_generation_retention_idx
  on public.concepts (created_at, source_id, generation_id)
  where source_id is not null and generation_id is not null and is_active = false;

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
    'sourceGenerations', (select count(*) from old_generations)
  );
$$;

revoke all on function public.sweep_runtime_ledgers(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.sweep_runtime_ledgers(timestamptz, integer)
  to service_role;

-- Expiry cleanup belongs to the bounded sweep, not every mutating API call.
-- Keep the five-argument overload for one deploy window: old app instances
-- still call it while the new app supplies an explicit stale cutoff below.
create or replace function public.claim_api_idempotency(
  p_scope text,
  p_key text,
  p_request_hash text,
  p_now timestamptz,
  p_stale_before timestamptz,
  p_expires_at timestamptz
)
returns table (
  claim_status text,
  claim_lease_token uuid,
  claim_response_status integer,
  claim_response_body text,
  claim_content_type text
)
language plpgsql volatile security definer set search_path = public
as $$
declare v_row public.api_idempotency_keys%rowtype;
begin
  select * into v_row from public.api_idempotency_keys
  where scope = p_scope and idempotency_key = p_key for update;

  if found and v_row.expires_at <= p_now then
    delete from public.api_idempotency_keys
    where scope = p_scope and idempotency_key = p_key;
    v_row := null;
  end if;

  if v_row.scope is not null then
    if v_row.request_hash <> p_request_hash then
      return query select 'conflict', null::uuid, null::integer, null::text, null::text;
      return;
    end if;
    if v_row.status = 'completed' then
      return query select 'completed', null::uuid, v_row.response_status,
        v_row.response_body, v_row.content_type;
      return;
    end if;
    if v_row.locked_at > p_stale_before then
      return query select 'running', null::uuid, null::integer, null::text, null::text;
      return;
    end if;
    update public.api_idempotency_keys
    set lease_token = gen_random_uuid(), locked_at = p_now,
        expires_at = p_expires_at, updated_at = p_now
    where scope = p_scope and idempotency_key = p_key
    returning * into v_row;
  else
    insert into public.api_idempotency_keys (
      scope, idempotency_key, request_hash, status, lease_token,
      locked_at, expires_at, created_at, updated_at
    ) values (
      p_scope, p_key, p_request_hash, 'running', gen_random_uuid(),
      p_now, p_expires_at, p_now, p_now
    ) returning * into v_row;
  end if;
  return query select 'claimed', v_row.lease_token, null::integer, null::text, null::text;
end;
$$;

revoke all on function public.claim_api_idempotency(
  text, text, text, timestamptz, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_api_idempotency(
  text, text, text, timestamptz, timestamptz, timestamptz
) to service_role;
