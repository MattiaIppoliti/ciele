-- Round-robin tenant fairness for shared drains plus a bounded queue-health
-- snapshot exposed to the cron report.
alter table public.background_jobs
  add column if not exists organization_id uuid
    references public.organizations(id) on delete cascade;

update public.background_jobs j
set organization_id = coalesce(
  (select kc.organization_id
   from public.sources s
   join public.knowledge_collections kc on kc.id = s.collection_id
   where s.id = j.source_id),
  case when j.payload ? 'organizationId'
    then (j.payload ->> 'organizationId')::uuid end,
  (select kc.organization_id
   from public.knowledge_collections kc
   where kc.id = j.payload ->> 'collectionId'),
  (select i.organization_id
   from public.improvements i
   where i.id = j.payload ->> 'improvementId')
)
where j.organization_id is null;

alter table public.background_jobs
  alter column organization_id set not null;

create index if not exists background_jobs_fair_claim_idx
  on public.background_jobs (kind, organization_id, status, next_run_at, created_at);
create index if not exists background_jobs_organization_idx
  on public.background_jobs (organization_id, created_at, id);

drop policy if exists "members read source jobs" on public.background_jobs;
drop policy if exists "editors create source jobs" on public.background_jobs;
drop policy if exists "editors update source jobs" on public.background_jobs;
create policy "members read organization jobs" on public.background_jobs
  for select using (private.is_org_member(organization_id));
create policy "editors create organization jobs" on public.background_jobs
  for insert with check (private.has_org_role(organization_id, 2));
create or replace function public.claim_background_jobs(
  p_kind text, p_worker_id text, p_now timestamptz,
  p_stale_before timestamptz, p_limit integer
)
returns setof public.background_jobs language sql volatile security invoker
set search_path = public as $$
  with eligible as (
    select j.id,
      j.organization_id as tenant_key,
      case when j.status = 'queued' then j.next_run_at else j.locked_at end as due_at,
      j.created_at
    from public.background_jobs j
    where j.kind = p_kind and (
      (j.status = 'queued' and j.next_run_at <= p_now and j.attempts < j.max_attempts)
      or (j.status = 'running' and j.locked_at is not null and j.locked_at <= p_stale_before)
    )
  ), ranked as (
    select *, row_number() over (
      partition by tenant_key order by due_at, created_at, id
    ) as tenant_position from eligible
  ), candidates as (
    select j.id from public.background_jobs j
    join ranked r on r.id = j.id
    order by r.tenant_position, r.due_at, r.created_at, r.id
    limit greatest(p_limit, 0)
    for update of j skip locked
  )
  update public.background_jobs j set
    status = 'running',
    attempts = case when j.status = 'running' and j.attempts >= j.max_attempts
      then j.attempts else j.attempts + 1 end,
    locked_at = p_now, locked_by = p_worker_id,
    lease_token = gen_random_uuid(), error = '', updated_at = p_now
  from candidates where j.id = candidates.id returning j.*;
$$;

create or replace function public.claim_turn_effects(
  p_message_id text, p_worker_id text, p_now timestamptz,
  p_stale_before timestamptz, p_limit integer
)
returns setof public.turn_effect_outbox language plpgsql volatile security definer
set search_path = public, private as $$
begin
  if auth.role() <> 'service_role' then
    raise insufficient_privilege using message = 'Effect drain requires service role';
  end if;
  return query with eligible as (
    select e.id, e.organization_id, e.next_run_at, e.created_at,
      row_number() over (partition by e.organization_id order by e.next_run_at, e.created_at, e.id) as tenant_position
    from public.turn_effect_outbox e
    where (p_message_id is null or e.message_id = p_message_id) and (
      (e.status = 'pending' and e.next_run_at <= p_now)
      or (e.status = 'running' and e.locked_at <= p_stale_before)
    )
  ), candidates as (
    select e.id from public.turn_effect_outbox e join eligible x on x.id = e.id
    order by x.tenant_position, x.next_run_at, x.created_at, x.id
    for update of e skip locked limit greatest(1, least(p_limit, 100))
  ) update public.turn_effect_outbox e set
    status = 'running', attempts = e.attempts + 1,
    lease_token = gen_random_uuid(), locked_by = p_worker_id,
    locked_at = p_now, updated_at = p_now
  from candidates c where e.id = c.id returning e.*;
end;
$$;

create or replace function public.get_work_queue_health(p_now timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with job_stats as (
    select organization_id, kind,
      count(*) filter (
        where status = 'queued' and next_run_at <= p_now and attempts < max_attempts
      )::integer as due,
      count(*) filter (where status = 'running')::integer as running,
      count(*) filter (
        where status = 'queued' and next_run_at > p_now and attempts < max_attempts
      )::integer as scheduled,
      count(*) filter (
        where status = 'failed' or (status = 'queued' and attempts >= max_attempts)
      )::integer as failed,
      min(next_run_at) filter (
        where status = 'queued' and next_run_at <= p_now and attempts < max_attempts
      ) as oldest
    from public.background_jobs
    group by organization_id, kind
  ), effect_stats as (
    select organization_id,
      count(*) filter (where status = 'pending' and next_run_at <= p_now)::integer as due,
      count(*) filter (where status = 'running')::integer as running,
      count(*) filter (where status = 'pending' and next_run_at > p_now)::integer as scheduled,
      count(*) filter (where status = 'failed')::integer as failed,
      min(next_run_at) filter (where status = 'pending' and next_run_at <= p_now) as oldest
    from public.turn_effect_outbox
    group by organization_id
  ), organizations as (
    select organization_id from job_stats
    union select organization_id from effect_stats
  )
  select jsonb_build_object(
    'backgroundJobs', coalesce((
      select jsonb_object_agg(kind, jsonb_build_object(
        'due', due, 'running', running, 'scheduled', scheduled,
        'failed', failed, 'oldestDueAt', oldest
      ))
      from (
        select kind, sum(due)::integer as due, sum(running)::integer as running,
          sum(scheduled)::integer as scheduled, sum(failed)::integer as failed,
          min(oldest) as oldest
        from job_stats
        group by kind
      ) q
    ), '{}'::jsonb),
    'turnEffects', coalesce((
      select jsonb_build_object(
        'due', coalesce(sum(due), 0)::integer,
        'running', coalesce(sum(running), 0)::integer,
        'scheduled', coalesce(sum(scheduled), 0)::integer,
        'failed', coalesce(sum(failed), 0)::integer,
        'oldestDueAt', min(oldest)
      ) from effect_stats
    ), jsonb_build_object('due', 0, 'running', 0, 'scheduled', 0, 'failed', 0, 'oldestDueAt', null)),
    'organizations', coalesce((
      select jsonb_object_agg(o.organization_id::text, jsonb_build_object(
        'backgroundJobs', coalesce((
          select jsonb_object_agg(j.kind, jsonb_build_object(
            'due', j.due, 'running', j.running, 'scheduled', j.scheduled,
            'failed', j.failed, 'oldestDueAt', j.oldest
          )) from job_stats j where j.organization_id = o.organization_id
        ), '{}'::jsonb),
        'turnEffects', coalesce((
          select jsonb_build_object(
            'due', e.due, 'running', e.running, 'scheduled', e.scheduled,
            'failed', e.failed, 'oldestDueAt', e.oldest
          ) from effect_stats e where e.organization_id = o.organization_id
        ), jsonb_build_object('due', 0, 'running', 0, 'scheduled', 0, 'failed', 0, 'oldestDueAt', null))
      )) from organizations o
    ), '{}'::jsonb)
  );
$$;

revoke all on function public.get_work_queue_health(timestamptz) from public, anon, authenticated;
grant execute on function public.get_work_queue_health(timestamptz) to service_role;
