-- Platform-wide superuser: an allowlisted account treated as a member of
-- every organization, in every org-scoped RLS policy, without needing an
-- organization_members row. private.is_org_member/private.has_org_role
-- already gate ~50 policies across the schema (see 0018's private-schema
-- move), so bypassing inside those two functions cascades everywhere with
-- no other policy edits.
--
-- Applied directly to the shared project via the
-- Supabase MCP on 2026-07-06; this file exists so local history and future
-- migrations stay in sync with what's actually live.

create table private.platform_superusers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table private.platform_superusers enable row level security;

create or replace function private.is_platform_superuser()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from private.platform_superusers where user_id = auth.uid()
  )
$$;

create or replace function private.is_org_member(org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select private.is_platform_superuser() or exists (
    select 1 from organization_members
    where organization_id = org and user_id = auth.uid()
  )
$$;

create or replace function private.has_org_role(org uuid, min_rank int)
returns boolean language sql stable security definer set search_path = public as $$
  select private.is_platform_superuser() or exists (
    select 1 from organization_members
    where organization_id = org
      and user_id = auth.uid()
      and public.role_rank(role) >= min_rank
  )
$$;

-- profiles' "read profiles of shared orgs" policy predates is_org_member
-- (raw join) and needs its own bypass so a superuser can see member
-- rosters across orgs they don't belong to.
drop policy if exists "read profiles of shared orgs" on public.profiles;
create policy "read profiles of shared orgs" on public.profiles
  for select using (
    id = auth.uid()
    or private.is_platform_superuser()
    or exists (
      select 1
      from organization_members mine
      join organization_members theirs
        on mine.organization_id = theirs.organization_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );

-- Deployment-configured allowlist of emails to auto-enroll as platform
-- superusers on signup. EMPTY BY DEFAULT: a fresh deployment grants no
-- cross-org access until an operator explicitly inserts a row (service
-- role / SQL console). RLS with no policies = invisible to every app role;
-- the signup trigger below reads it as `security definer`.
-- (#431: this replaced a hardcoded personal-email literal, so no account is
-- ever silently granted cross-org access on a new deployment.)
create table private.platform_superuser_emails (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

alter table private.platform_superuser_emails enable row level security;

-- Auto-enroll allowlisted emails as platform superusers the moment their
-- auth.users row exists (covers fresh signups on any environment sharing
-- this project). Keep the allowlist in sync with apps/admin's
-- PLATFORM_ADMIN_EMAILS if the same humans should hold both surfaces.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email;
  if exists (
    select 1 from private.platform_superuser_emails
    where email = lower(coalesce(new.email, ''))
  ) then
    insert into private.platform_superusers (user_id) values (new.id)
    on conflict (user_id) do nothing;
  end if;
  return new;
end $$;
