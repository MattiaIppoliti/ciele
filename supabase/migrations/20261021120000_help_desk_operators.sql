-- Operators per Help Desk, their Available/Away status, and assignment (#1084).
--
-- A Help Desk names the Members who staff its Live operator channel, each with
-- a capacity (the most Conversations they hold at once). Each operator sets
-- themselves Available or Away. A waiting Conversation is assigned to the
-- least-loaded Available operator of its desk; the rule is pure TypeScript
-- (`pickOperator` in core), these tables are only its inputs.
--
-- The last-assigned time the tie-break reads is not stored here: it is
-- `conversations.assigned_at`, which a takeover and a release now leave in
-- place, so assignment history is the conversations themselves.

create table if not exists public.help_desk_operators (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  help_desk_id text not null references public.help_desks (id) on delete cascade,
  member_id uuid not null references auth.users (id) on delete cascade,
  capacity integer not null default 3 check (capacity between 1 and 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (help_desk_id, member_id)
);
create index if not exists help_desk_operators_org_idx on public.help_desk_operators (organization_id);
create index if not exists help_desk_operators_member_idx on public.help_desk_operators (member_id);

alter table public.help_desk_operators enable row level security;

create policy "members read desk operators" on public.help_desk_operators
  for select using (private.is_org_member(organization_id));
-- Staffing a desk is desk configuration: an Editor's act, like the desk itself.
create policy "editors add desk operators" on public.help_desk_operators
  for insert with check (
    private.has_org_role(organization_id, 2)
    and exists (
      select 1 from public.help_desks d
      where d.id = help_desk_id and d.organization_id = help_desk_operators.organization_id
    )
  );
create policy "editors edit desk operators" on public.help_desk_operators
  for update using (private.has_org_role(organization_id, 2))
  with check (private.has_org_role(organization_id, 2));
create policy "editors remove desk operators" on public.help_desk_operators
  for delete using (private.has_org_role(organization_id, 2));

create table if not exists public.operator_presence (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  member_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'away' check (status in ('available', 'away')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, member_id)
);
create index if not exists operator_presence_member_idx on public.operator_presence (member_id);

alter table public.operator_presence enable row level security;

-- Everyone in the Organization may see who is Available: the Inbox and the
-- assignment read it. Only the Member sets their own, and only a Member who
-- may answer Visitors at all.
create policy "members read operator presence" on public.operator_presence
  for select using (private.is_org_member(organization_id));
create policy "operators set their own presence" on public.operator_presence
  for insert with check (
    member_id = (select auth.uid())
    and private.can_operate_conversations(organization_id)
  );
create policy "operators update their own presence" on public.operator_presence
  for update using (member_id = (select auth.uid()))
  with check (
    member_id = (select auth.uid())
    and private.can_operate_conversations(organization_id)
  );
create policy "operators clear their own presence" on public.operator_presence
  for delete using (member_id = (select auth.uid()));

-- The tie-break reads the latest assignment per operator.
create index if not exists conversations_assigned_member_idx
  on public.conversations (assigned_member_id, assigned_at)
  where assigned_member_id is not null;
