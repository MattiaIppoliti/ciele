-- Quick Texts (#1085): saved replies a Member inserts into the Inbox reply box.
--
-- Organization-level and shared: every Member who can reply can use every
-- Quick Text, so reading is membership. Writing is an Editor's act, like the
-- rest of the Organization's configuration; a Support Agent (#1086) uses
-- Quick Texts but does not author them.

create table if not exists public.quick_texts (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null check (char_length(body) between 1 and 4000),
  folder text check (folder is null or char_length(btrim(folder)) between 1 and 80),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quick_texts_org_idx on public.quick_texts (organization_id, folder, title);
create index if not exists quick_texts_created_by_idx on public.quick_texts (created_by);

alter table public.quick_texts enable row level security;

create policy "members read quick texts" on public.quick_texts
  for select using (private.is_org_member(organization_id));
create policy "editors create quick texts" on public.quick_texts
  for insert with check (private.has_org_role(organization_id, 2));
create policy "editors edit quick texts" on public.quick_texts
  for update using (private.has_org_role(organization_id, 2))
  with check (private.has_org_role(organization_id, 2));
create policy "editors delete quick texts" on public.quick_texts
  for delete using (private.has_org_role(organization_id, 2));
