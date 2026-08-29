-- Agentic runtime deepening: per-assistant tool configuration, reusable
-- org-level Skills (prompt templates attachable to assistants), and a
-- persistent per-conversation session state bag the runtime's tools can
-- read/write across turns (tau-style sessions).

-- Per-assistant tool config: built-in enablement overrides + custom HTTP
-- tools ({ builtIns?: {...}, custom?: CustomToolConfig[] }, see
-- packages/db/src/types.ts AssistantTools).
alter table public.assistants
  add column if not exists tools jsonb not null default '{}'::jsonb;

-- Persistent session state, written back by the runtime after a turn when a
-- tool mutated it (e.g. the `remember` tool's session memory).
alter table public.conversations
  add column if not exists session_state jsonb not null default '{}'::jsonb;

-- Reusable Skills: org-level prompt templates layered into the system prompt
-- of every assistant they're attached to.
create table public.skills (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  description text not null default '',
  prompt text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists skills_organization_id_idx
  on public.skills (organization_id);

alter table public.skills enable row level security;

create policy "members read skills" on public.skills
  for select using (private.is_org_member(organization_id));
create policy "editors create skills" on public.skills
  for insert with check (private.has_org_role(organization_id, 2));
create policy "editors update skills" on public.skills
  for update using (private.has_org_role(organization_id, 2));
create policy "editors delete skills" on public.skills
  for delete using (private.has_org_role(organization_id, 2));

-- Attachment join: which skills an assistant runs with.
create table public.assistant_skills (
  assistant_id text not null references public.assistants (id) on delete cascade,
  skill_id text not null references public.skills (id) on delete cascade,
  position int not null default 0,
  primary key (assistant_id, skill_id)
);

create index if not exists assistant_skills_skill_id_idx
  on public.assistant_skills (skill_id);

alter table public.assistant_skills enable row level security;

create policy "members read assistant skills" on public.assistant_skills
  for select using (exists (
    select 1 from public.assistants a
    where a.id = assistant_skills.assistant_id
      and private.is_org_member(a.organization_id)
  ));
create policy "editors create assistant skills" on public.assistant_skills
  for insert with check (exists (
    select 1 from public.assistants a
    where a.id = assistant_skills.assistant_id
      and private.has_org_role(a.organization_id, 2)
  ));
create policy "editors delete assistant skills" on public.assistant_skills
  for delete using (exists (
    select 1 from public.assistants a
    where a.id = assistant_skills.assistant_id
      and private.has_org_role(a.organization_id, 2)
  ));
