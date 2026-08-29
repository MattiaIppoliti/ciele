-- Claim generic background jobs in one PostgreSQL statement. The previous
-- PostgREST select-then-update sequence let overlapping workers lease the same
-- row. Security stays invoker-scoped: authenticated accelerators see only jobs
-- allowed by RLS, while the scheduled service-role drainer sees every org.

alter table public.background_jobs
  add column if not exists lease_token uuid;

create index if not exists background_jobs_queued_claim_idx
  on public.background_jobs (kind, next_run_at, created_at, id)
  where status = 'queued';

create index if not exists background_jobs_stale_claim_idx
  on public.background_jobs (kind, locked_at, created_at, id)
  where status = 'running';

create or replace function public.claim_background_jobs(
  p_kind text,
  p_worker_id text,
  p_now timestamptz,
  p_stale_before timestamptz,
  p_limit integer
)
returns setof public.background_jobs
language sql
volatile
security invoker
set search_path = public
as $$
  with candidates as (
    select j.id
    from public.background_jobs j
    where j.kind = p_kind
      and (
        (
          j.status = 'queued'
          and j.next_run_at <= p_now
          and j.attempts < j.max_attempts
        )
        or (
          j.status = 'running'
          and j.locked_at is not null
          and j.locked_at <= p_stale_before
        )
      )
    order by
      case when j.status = 'queued' then j.next_run_at else j.locked_at end,
      j.created_at,
      j.id
    limit greatest(p_limit, 0)
    for update skip locked
  )
  update public.background_jobs j
  set status = 'running',
      attempts = case
        when j.status = 'running' and j.attempts >= j.max_attempts
          then j.attempts
        else j.attempts + 1
      end,
      locked_at = p_now,
      locked_by = p_worker_id,
      lease_token = gen_random_uuid(),
      error = '',
      updated_at = p_now
  from candidates
  where j.id = candidates.id
  returning j.*;
$$;

revoke all on function public.claim_background_jobs(
  text, text, timestamptz, timestamptz, integer
) from public, anon;
revoke all on function public.claim_background_jobs(
  text, text, timestamptz, timestamptz, integer
) from authenticated;
grant execute on function public.claim_background_jobs(
  text, text, timestamptz, timestamptz, integer
) to service_role;

-- A lease holder may settle only its own claim generation. Worker names are
-- intentionally not fences: scheduled runs reuse a stable diagnostic name.
create or replace function public.settle_background_job(
  p_id text,
  p_lease_token uuid,
  p_now timestamptz,
  p_status text,
  p_error text,
  p_next_run_at timestamptz
)
returns boolean
language sql
volatile
security invoker
set search_path = public
as $$
  with settled as (
    update public.background_jobs j
    set status = p_status,
        error = p_error,
        next_run_at = case
          when p_status = 'queued' then p_next_run_at
          else j.next_run_at
        end,
        locked_at = null,
        locked_by = null,
        lease_token = null,
        updated_at = p_now
    where j.id = p_id
      and j.status = 'running'
      and j.lease_token = p_lease_token
      and p_status in ('queued', 'succeeded', 'failed')
      and (p_status <> 'queued' or p_next_run_at is not null)
    returning 1
  )
  select exists(select 1 from settled);
$$;

create or replace function public.renew_background_job_lease(
  p_id text,
  p_lease_token uuid,
  p_now timestamptz
)
returns boolean
language sql
volatile
security invoker
set search_path = public
as $$
  with renewed as (
    update public.background_jobs j
    set locked_at = p_now, updated_at = p_now
    where j.id = p_id
      and j.status = 'running'
      and j.lease_token = p_lease_token
    returning 1
  )
  select exists(select 1 from renewed);
$$;

revoke all on function public.settle_background_job(
  text, uuid, timestamptz, text, text, timestamptz
) from public, anon;
revoke all on function public.settle_background_job(
  text, uuid, timestamptz, text, text, timestamptz
) from authenticated;
grant execute on function public.settle_background_job(
  text, uuid, timestamptz, text, text, timestamptz
) to service_role;
revoke all on function public.renew_background_job_lease(
  text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.renew_background_job_lease(
  text, uuid, timestamptz
) to service_role;
