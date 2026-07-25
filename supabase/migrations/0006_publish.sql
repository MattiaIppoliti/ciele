-- Publish as immutable snapshots (CONTEXT.md: Publication) + minimal Style.

alter table public.assistants
  add column if not exists style jsonb not null default '{}',
  add column if not exists allowed_domains text[] not null default '{}';

create table public.publications (
  id text primary key,
  assistant_id text not null references public.assistants (id) on delete cascade,
  version integer not null,
  -- Immutable snapshot: assistant config, flows, style, collections refs.
  config jsonb not null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (assistant_id, version)
);

create index publications_assistant_idx
  on public.publications (assistant_id, version desc);

alter table public.publications enable row level security;

-- Admin side: org members read, admins publish. The public widget reads
-- publications through the service-role key (server routes only).
create policy "members read publications" on public.publications
  for select using (exists (
    select 1 from public.assistants a
    where a.id = publications.assistant_id and public.is_org_member(a.organization_id)
  ));
create policy "admins create publications" on public.publications
  for insert with check (exists (
    select 1 from public.assistants a
    where a.id = publications.assistant_id and public.has_org_role(a.organization_id, 3)
  ));
