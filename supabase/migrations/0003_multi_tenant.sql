-- Multi-tenancy: organizations, members with RBAC roles, invites.
-- See CONTEXT.md (Organization, Member, Role) and the 4-role matrix:
-- owner > admin > editor > viewer.

create type public.org_role as enum ('owner', 'admin', 'editor', 'viewer');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null default '',
  role public.org_role not null default 'editor',
  token text not null unique,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  accepted_by uuid references auth.users (id),
  accepted_at timestamptz
);

-- Profile mirror of auth.users so member lists can show emails under RLS.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default ''
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.assistants
  add column if not exists organization_id uuid references public.organizations (id) on delete cascade;

create index if not exists assistants_organization_id_idx on public.assistants (organization_id);

-- Role helpers -------------------------------------------------------------

create or replace function public.role_rank(r public.org_role)
returns int language sql immutable as $$
  select case r when 'owner' then 4 when 'admin' then 3 when 'editor' then 2 else 1 end
$$;

create or replace function public.is_org_member(org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from organization_members
    where organization_id = org and user_id = auth.uid()
  )
$$;

create or replace function public.has_org_role(org uuid, min_rank int)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from organization_members
    where organization_id = org
      and user_id = auth.uid()
      and public.role_rank(role) >= min_rank
  )
$$;

-- RPCs ----------------------------------------------------------------------

create or replace function public.create_organization(org_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into organizations (name) values (org_name) returning id into new_id;
  insert into organization_members (organization_id, user_id, role)
  values (new_id, auth.uid(), 'owner');
  return new_id;
end $$;

create or replace function public.accept_invite(invite_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv record;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select * into inv from organization_invites
  where token = invite_token and accepted_at is null;
  if inv is null then
    raise exception 'invalid or already used invite';
  end if;
  insert into organization_members (organization_id, user_id, role)
  values (inv.organization_id, auth.uid(), inv.role)
  on conflict (organization_id, user_id) do nothing;
  update organization_invites
  set accepted_by = auth.uid(), accepted_at = now()
  where id = inv.id;
  return inv.organization_id;
end $$;

-- RLS ------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invites enable row level security;
alter table public.profiles enable row level security;

create policy "members read org" on public.organizations
  for select using (public.is_org_member(id));
create policy "owner updates org" on public.organizations
  for update using (public.has_org_role(id, 4)) with check (public.has_org_role(id, 4));

create policy "members read members" on public.organization_members
  for select using (public.is_org_member(organization_id));
create policy "admins add members" on public.organization_members
  for insert with check (public.has_org_role(organization_id, 3));
create policy "owner updates roles" on public.organization_members
  for update using (public.has_org_role(organization_id, 4));
create policy "admins remove members or self-leave" on public.organization_members
  for delete using (
    public.has_org_role(organization_id, 3) or user_id = auth.uid()
  );

create policy "admins read invites" on public.organization_invites
  for select using (public.has_org_role(organization_id, 3));
create policy "admins create invites" on public.organization_invites
  for insert with check (public.has_org_role(organization_id, 3));
create policy "admins revoke invites" on public.organization_invites
  for delete using (public.has_org_role(organization_id, 3));

create policy "read profiles of shared orgs" on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1
      from organization_members mine
      join organization_members theirs
        on mine.organization_id = theirs.organization_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );

-- Replace the wide-open demo policies with org-scoped ones.

drop policy if exists "assistants full access" on public.assistants;
drop policy if exists "flows full access" on public.flows;

create policy "members read assistants" on public.assistants
  for select using (public.is_org_member(organization_id));
create policy "editors create assistants" on public.assistants
  for insert with check (public.has_org_role(organization_id, 2));
create policy "editors update assistants" on public.assistants
  for update using (public.has_org_role(organization_id, 2));
create policy "admins delete assistants" on public.assistants
  for delete using (public.has_org_role(organization_id, 3));

create policy "members read flows" on public.flows
  for select using (exists (
    select 1 from public.assistants a
    where a.id = flows.assistant_id and public.is_org_member(a.organization_id)
  ));
create policy "editors create flows" on public.flows
  for insert with check (exists (
    select 1 from public.assistants a
    where a.id = flows.assistant_id and public.has_org_role(a.organization_id, 2)
  ));
create policy "editors update flows" on public.flows
  for update using (exists (
    select 1 from public.assistants a
    where a.id = flows.assistant_id and public.has_org_role(a.organization_id, 2)
  ));
create policy "editors delete flows" on public.flows
  for delete using (exists (
    select 1 from public.assistants a
    where a.id = flows.assistant_id and public.has_org_role(a.organization_id, 2)
  ));
