-- Standing goals (spec: scheduled golden-question checks feeding Alerts).
-- A goal is an admin-authored question with machine-checkable expectations,
-- re-verified on a schedule by the goal runner (next slice). Runs are a
-- capped ledger so flaky goals are visible; quarantine parks a goal without
-- deleting its history.

create table public.assistant_goals (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  assistant_id text not null references public.assistants (id) on delete cascade,
  question text not null,
  status text not null default 'active'
    check (status in ('active', 'quarantined')),
  -- { mustCiteSources?: boolean, expectedSourceUrl?: string, mustContain?: string[] }
  -- "answer is not the fallback apology" is always checked and not stored.
  expectations jsonb not null default '{}',
  last_run_at timestamptz,
  last_result text check (last_result in ('pass', 'fail')),
  last_detail text,
  created_at timestamptz not null default now()
);

create index assistant_goals_assistant_idx
  on public.assistant_goals (assistant_id, created_at);
create index assistant_goals_org_idx
  on public.assistant_goals (organization_id);

alter table public.assistant_goals enable row level security;

create policy "members read goals" on public.assistant_goals
  for select using (private.is_org_member(organization_id));
create policy "editors create goals" on public.assistant_goals
  for insert with check (private.has_org_role(organization_id, 2));
create policy "editors update goals" on public.assistant_goals
  for update using (private.has_org_role(organization_id, 2));
create policy "editors delete goals" on public.assistant_goals
  for delete using (private.has_org_role(organization_id, 2));

-- Run ledger: appended by the scheduled runner (service role only, no
-- insert policy on purpose); members read for flakiness triage.
create table public.assistant_goal_runs (
  id uuid primary key default gen_random_uuid(),
  goal_id text not null references public.assistant_goals (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  ran_at timestamptz not null default now(),
  pass boolean not null,
  detail text not null default '',
  duration_ms integer not null default 0
);

create index assistant_goal_runs_goal_idx
  on public.assistant_goal_runs (goal_id, ran_at desc);

alter table public.assistant_goal_runs enable row level security;

create policy "members read goal runs" on public.assistant_goal_runs
  for select using (private.is_org_member(organization_id));
