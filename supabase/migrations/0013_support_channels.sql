-- Support channels: escalation methods offered by a help desk.

create table public.support_channels (
  id text primary key,
  help_desk_id text not null references public.help_desks (id) on delete cascade,
  kind text not null,
  name text not null,
  position integer not null default 0,
  enabled boolean not null default true,
  config jsonb not null default '{}',
  form_title text not null default 'Send us a message',
  form jsonb not null default '[]',
  confirmation_message text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_channels_help_desk_id_idx
  on public.support_channels (help_desk_id);

alter table public.support_channels enable row level security;

create policy "members read support channels" on public.support_channels
  for select using (exists (
    select 1 from public.help_desks d
    where d.id = support_channels.help_desk_id
      and public.is_org_member(d.organization_id)
  ));
create policy "editors create support channels" on public.support_channels
  for insert with check (exists (
    select 1 from public.help_desks d
    where d.id = support_channels.help_desk_id
      and public.has_org_role(d.organization_id, 2)
  ));
create policy "editors update support channels" on public.support_channels
  for update using (exists (
    select 1 from public.help_desks d
    where d.id = support_channels.help_desk_id
      and public.has_org_role(d.organization_id, 2)
  ));
create policy "editors delete support channels" on public.support_channels
  for delete using (exists (
    select 1 from public.help_desks d
    where d.id = support_channels.help_desk_id
      and public.has_org_role(d.organization_id, 2)
  ));
