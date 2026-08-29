-- Compost claim (spec: a stuck or overlapping tick must never double-digest a
-- week and clone proposals). The weekly run record only lands at window END, so
-- two ticks inside the same window both read the assistant as due and both
-- digest. A per-assistant claim stamp written at window START closes that: the
-- second tick sees the assistant already claimed and skips before any digest or
-- model call. The claim expires with the cadence window, so a crashed run
-- retries next window (mirrors the goal runner's lease).

create table public.compost_claims (
  assistant_id text primary key references public.assistants (id) on delete cascade,
  claimed_at timestamptz not null default now()
);

alter table public.compost_claims enable row level security;
-- Service-role only: the scheduled compost pass writes and reads these.

-- Atomically claims published assistants of opted-in orgs whose last compost run
-- predates p_due_before and that carry no fresh claim. The claim insert on the
-- assistant-id primary key serializes concurrent ticks; a stale claim (older
-- than p_stale_before) is re-claimable.
create or replace function public.claim_due_compost_assistants(
  p_due_before timestamptz,
  p_stale_before timestamptz,
  p_limit integer
)
returns table (
  assistant_id text,
  organization_id uuid,
  last_run_at timestamptz
)
language plpgsql
volatile
set search_path = public
as $$
begin
  return query
  with due as (
    select
      a.id as assistant_id,
      a.organization_id,
      r.created_at as last_run_at
    from public.assistants a
    join public.organizations o on o.id = a.organization_id
    left join lateral (
      select created_at from public.compost_runs
      where assistant_id = a.id
      order by created_at desc
      limit 1
    ) r on true
    left join public.compost_claims cl on cl.assistant_id = a.id
    where o.compost_opt_out = false
      and exists (select 1 from public.publications p where p.assistant_id = a.id)
      and (r.created_at is null or r.created_at < p_due_before)
      and (cl.assistant_id is null or cl.claimed_at < p_stale_before)
    order by r.created_at asc nulls first
    limit p_limit
  ),
  claimed as (
    insert into public.compost_claims (assistant_id, claimed_at)
    select assistant_id, now() from due
    on conflict (assistant_id) do update
      set claimed_at = now()
      where public.compost_claims.claimed_at < p_stale_before
    returning assistant_id
  )
  select d.assistant_id, d.organization_id, d.last_run_at
  from due d
  join claimed c using (assistant_id);
end;
$$;
