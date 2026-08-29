-- Help desks: org-level escalation destinations + per-assistant settings.

create table public.help_desks (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists help_desks_organization_id_idx
  on public.help_desks (organization_id);

alter table public.help_desks enable row level security;

create policy "members read help desks" on public.help_desks
  for select using (public.is_org_member(organization_id));
create policy "editors create help desks" on public.help_desks
  for insert with check (public.has_org_role(organization_id, 2));
create policy "editors update help desks" on public.help_desks
  for update using (public.has_org_role(organization_id, 2));
create policy "editors delete help desks" on public.help_desks
  for delete using (public.has_org_role(organization_id, 2));

-- Per-assistant escalation settings (Help Desks setup page).
alter table public.assistants
  add column if not exists help_desk_settings jsonb not null default '{}';
