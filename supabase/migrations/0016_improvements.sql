-- Improvements: AI-answer-quality tracker items (the Improvements Kanban).
-- Sourced from the Inbox "Improve Answer" action (manual flags), and later the
-- Flow "Improvement" action and help-desk "Auto-generate improvements". Each
-- item links to one or more assistant messages (the flagged answers).

create table public.improvements (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Per-org sequential number rendered as the human key "IMP-<seq>".
  seq integer not null,
  title text not null,
  description text not null default '',
  status text not null default 'to_do'
    check (status in ('to_do', 'in_progress', 'in_review', 'done', 'archived')),
  priority text not null default 'none'
    check (priority in ('high', 'medium', 'low', 'none')),
  tags jsonb not null default '[]'::jsonb,
  assignee_id uuid references auth.users (id),
  due_date date,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, seq)
);

create index if not exists improvements_organization_id_idx
  on public.improvements (organization_id);
create index if not exists improvements_status_idx
  on public.improvements (organization_id, status);

-- Per-org monotonic counter backing the "IMP-<seq>" key. next_improvement_seq()
-- bumps it atomically so concurrent creates never collide.
create table public.improvement_counters (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  next_seq integer not null default 1
);

create or replace function public.next_improvement_seq(org uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare allocated integer;
begin
  insert into improvement_counters (organization_id, next_seq)
  values (org, 2)
  on conflict (organization_id)
  do update set next_seq = improvement_counters.next_seq + 1
  returning next_seq - 1 into allocated;
  return allocated;
end $$;

-- Link table: an improvement is associated with one or more assistant messages.
-- The same issue can recur across conversations, so this is many-to-many.
create table public.improvement_messages (
  id text primary key,
  improvement_id text not null references public.improvements (id) on delete cascade,
  message_id text not null references public.messages (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (improvement_id, message_id)
);

create index if not exists improvement_messages_improvement_idx
  on public.improvement_messages (improvement_id);
create index if not exists improvement_messages_message_idx
  on public.improvement_messages (message_id);

alter table public.improvements enable row level security;
alter table public.improvement_counters enable row level security;
alter table public.improvement_messages enable row level security;

-- Improvements are org-scoped: members read; editors (rank 2) and above manage.
create policy "members read improvements" on public.improvements
  for select using (public.is_org_member(organization_id));
create policy "editors create improvements" on public.improvements
  for insert with check (public.has_org_role(organization_id, 2));
create policy "editors update improvements" on public.improvements
  for update using (public.has_org_role(organization_id, 2));
create policy "editors delete improvements" on public.improvements
  for delete using (public.has_org_role(organization_id, 2));

-- Counter rows are read by members; writes happen only via the security-definer
-- next_improvement_seq() function, so no insert/update policy is exposed.
create policy "members read improvement counters" on public.improvement_counters
  for select using (public.is_org_member(organization_id));

-- Link rows inherit access from their parent improvement.
create policy "members read improvement messages" on public.improvement_messages
  for select using (exists (
    select 1 from public.improvements i
    where i.id = improvement_messages.improvement_id
      and public.is_org_member(i.organization_id)
  ));
create policy "editors create improvement messages" on public.improvement_messages
  for insert with check (exists (
    select 1 from public.improvements i
    where i.id = improvement_messages.improvement_id
      and public.has_org_role(i.organization_id, 2)
  ));
create policy "editors delete improvement messages" on public.improvement_messages
  for delete using (exists (
    select 1 from public.improvements i
    where i.id = improvement_messages.improvement_id
      and public.has_org_role(i.organization_id, 2)
  ));
