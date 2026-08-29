-- Per-assistant access overrides ("Manage access", PRD #296 / issue #297).
--
-- A row overrides a Member's org Role for one Assistant: viewer/editor/admin
-- replace the org role in both directions, 'denied' hides the assistant
-- entirely. No row = "System Role" (inherit the org role). Org owners and
-- platform superusers are exempt: the resolver ignores override rows for
-- them, so an owner can never be locked out of an assistant.
--
-- All enforcement funnels through one resolver, private.has_assistant_role,
-- mirroring private.has_org_role (0018 private-schema move; 0034 superuser
-- bypass). This migration only rewrites the assistants SELECT policy;
-- UPDATE/DELETE (#299) and child-table policies (#300) follow.

create type public.assistant_access_role as enum ('denied', 'viewer', 'editor', 'admin');

create table public.assistant_access (
  -- text, not uuid: assistants use shortId() keys (0001).
  assistant_id text not null references public.assistants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.assistant_access_role not null,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users (id),
  primary key (assistant_id, user_id)
);

create index assistant_access_user_id_idx on public.assistant_access (user_id);

-- Same dual-FK pattern as organization_members (0020): PostgREST embeds need
-- a direct FK onto profiles so access lists can join member profile data in
-- one query. profiles rows exist for every auth user via handle_new_user.
alter table public.assistant_access
  add constraint assistant_access_user_id_profiles_fk
  foreign key (user_id) references public.profiles (id) on delete cascade;

-- Audit stamp: granted_at/granted_by always reflect the last change and the
-- caller who made it, regardless of what the client sends.
create or replace function private.stamp_assistant_access()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.granted_at := now();
  new.granted_by := auth.uid();
  return new;
end $$;

create trigger assistant_access_stamp
  before insert or update on public.assistant_access
  for each row execute function private.stamp_assistant_access();

-- Removing a member from the organization removes their overrides on that
-- org's assistants (the auth.users FK only covers account deletion).
create or replace function private.handle_member_removed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.assistant_access aa
  using public.assistants a
  where aa.assistant_id = a.id
    and a.organization_id = old.organization_id
    and aa.user_id = old.user_id;
  return old;
end $$;

create trigger on_org_member_removed
  after delete on public.organization_members
  for each row execute function private.handle_member_removed();

-- Rank helpers ---------------------------------------------------------------

-- Sibling of public.role_rank (0003): denied ranks below viewer so a single
-- ">= min_rank" comparison covers both capability checks and visibility.
-- strict: NULL in -> NULL out, so the resolver's coalesce() falls through to
-- the org role when no override row exists (a plain CASE would return the
-- 'denied' rank 0 for NULL and lock out every member without an override).
create or replace function public.assistant_access_rank(r public.assistant_access_role)
returns int language sql immutable strict as $$
  select case r when 'admin' then 3 when 'editor' then 2 when 'viewer' then 1 else 0 end
$$;

-- THE resolver: effective per-assistant rank >= min_rank?
--   platform superuser  -> always true (0034 pattern)
--   org owner           -> org rank (overrides ignored; can't be locked out)
--   member w/ override  -> override rank ('denied' = 0)
--   member, no override -> org rank ("System Role")
--   non-member          -> false
create or replace function private.has_assistant_role(assistant text, min_rank int)
returns boolean language sql stable security definer set search_path = public as $$
  select
    private.is_platform_superuser()
    or exists (
      select 1
      from public.assistants a
      join public.organization_members m on m.organization_id = a.organization_id
      left join public.assistant_access aa
        on aa.assistant_id = a.id and aa.user_id = m.user_id
      where a.id = assistant
        and m.user_id = auth.uid()
        and case
          when m.role = 'owner' then public.role_rank(m.role)
          else coalesce(public.assistant_access_rank(aa.role), public.role_rank(m.role))
        end >= min_rank
    )
$$;

-- RLS ------------------------------------------------------------------------

alter table public.assistant_access enable row level security;

-- Managing access is an ORG-level power (Admin+): a per-assistant admin
-- override must never grant it, so these policies check has_org_role, not
-- the resolver (PRD #296, capability model).
create policy "admins read assistant access" on public.assistant_access
  for select using (exists (
    select 1 from public.assistants a
    where a.id = assistant_access.assistant_id
      and private.has_org_role(a.organization_id, 3)
  ));
create policy "admins grant assistant access" on public.assistant_access
  for insert with check (exists (
    select 1 from public.assistants a
    where a.id = assistant_access.assistant_id
      and private.has_org_role(a.organization_id, 3)
  ));
create policy "admins update assistant access" on public.assistant_access
  for update using (exists (
    select 1 from public.assistants a
    where a.id = assistant_access.assistant_id
      and private.has_org_role(a.organization_id, 3)
  ));
create policy "admins revoke assistant access" on public.assistant_access
  for delete using (exists (
    select 1 from public.assistants a
    where a.id = assistant_access.assistant_id
      and private.has_org_role(a.organization_id, 3)
  ));

-- Visibility now flows through the resolver: a 'denied' row hides the
-- assistant from that member; everyone else behaves exactly as before
-- (no override row -> org role -> rank >= 1 for any member).
drop policy "members read assistants" on public.assistants;
create policy "members read assistants" on public.assistants
  for select using (private.has_assistant_role(id, 1));
