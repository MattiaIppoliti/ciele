-- Compost loop (spec: weekly exhaust into proposed Improvements). One run
-- record per (assistant, window) is both the idempotence marker and the
-- clean-week evidence; the runner only writes Improvements and these rows.

create table public.compost_runs (
  id uuid primary key default gen_random_uuid(),
  assistant_id text not null references public.assistants (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  window_start timestamptz not null,
  window_end timestamptz not null,
  proposals integer not null default 0,
  clean boolean not null default false,
  created_at timestamptz not null default now()
);

create index compost_runs_assistant_idx
  on public.compost_runs (assistant_id, created_at desc);

alter table public.compost_runs enable row level security;

create policy "members read compost runs" on public.compost_runs
  for select using (private.is_org_member(organization_id));

-- Per-org opt-out (default on). Admin-editable via the existing org policies.
alter table public.organizations
  add column if not exists compost_opt_out boolean not null default false;

-- Published assistants due for a compost pass: opted-in orgs, last run older
-- than the window (or never run).
create or replace function public.list_due_compost_assistants(
  p_due_before timestamptz,
  p_limit integer
)
returns table (
  assistant_id text,
  organization_id uuid,
  last_run_at timestamptz
)
language sql
stable
set search_path = public
as $$
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
  where o.compost_opt_out = false
    and exists (select 1 from public.publications p where p.assistant_id = a.id)
    and (r.created_at is null or r.created_at < p_due_before)
  order by r.created_at asc nulls first
  limit p_limit;
$$;
