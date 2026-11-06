-- Custom Roles built from granular Capabilities (map #1164, ADR-0028).
--
-- A Role is now a row: a named set of Capabilities (`flows:edit`,
-- `inbox:operate`, ...). Every Organization gets six built-ins (Owner, Admin,
-- Editor, Support Agent, Viewer, Data Viewer); every one but Owner can be
-- edited, and custom Roles can be created and deleted.
--
-- Expand, without moving any existing check:
--
-- * organization_members, organization_invites and organization_api_keys
--   gain role_id. Their old `role` column stays and becomes the Role's
--   *tier*: the ladder Role (admin/editor/support_agent/viewer, owner for the
--   Owner Role) the highest of its Capabilities sits at. Triggers keep it
--   equal to the Role's tier, so the 151 policies that call
--   private.has_org_role(org, n), and every reader of `role`, keep working
--   unchanged and see an upper bound. The Operation layer checks the exact
--   Capability (packages/core/src/capabilities.ts).
-- * A writer that still sets only `role` (an old client, a migration) is
--   mapped onto the built-in of that name.
-- * The privilege tables themselves (members, invitations, API keys, Roles,
--   Assistant access, conversation takeover) check a Capability, not a rank:
--   a custom Role at the Admin tier without members:manage must not be able
--   to write organization_members through PostgREST.
-- * Nobody can hand on what they do not hold: a Role, an invitation, a member
--   assignment or an API key whose Capabilities exceed the caller's is
--   refused here, Owners and the service role excepted.

-- The catalogue --------------------------------------------------------------

create table private.capability_catalog (
  id text primary key,
  tier text not null check (tier in ('member','operate','edit','publish','manageMembers','manageApiKeys','changeRoles')),
  position int not null unique,
  -- What must be on for this one to work; a Role is saved closed over it.
  requires text[] not null default '{}'
);

insert into private.capability_catalog (id, tier, position, requires) values
  ('assistants:view', 'member', 1, '{}'),
  ('assistants:chat', 'member', 2, '{assistants:view}'),
  ('assistants:edit', 'edit', 3, '{assistants:view}'),
  ('assistants:delete', 'publish', 4, '{assistants:view}'),
  ('assistants:publish', 'publish', 5, '{assistants:view}'),
  ('flows:view', 'member', 6, '{assistants:view}'),
  ('flows:edit', 'edit', 7, '{flows:view}'),
  ('flows:delete', 'edit', 8, '{flows:view}'),
  ('evaluations:run', 'edit', 9, '{assistants:view}'),
  ('knowledge:view', 'member', 10, '{}'),
  ('knowledge:edit', 'edit', 11, '{knowledge:view}'),
  ('knowledge:delete', 'edit', 12, '{knowledge:view}'),
  ('applications:view', 'member', 13, '{knowledge:view}'),
  ('applications:edit', 'edit', 14, '{applications:view}'),
  ('applications:connect', 'publish', 15, '{applications:view}'),
  ('skills:view', 'member', 16, '{}'),
  ('skills:edit', 'edit', 17, '{skills:view}'),
  ('apiIntegrations:view', 'member', 18, '{assistants:view}'),
  ('apiIntegrations:edit', 'edit', 19, '{apiIntegrations:view}'),
  ('inbox:view', 'member', 20, '{}'),
  ('inbox:triage', 'member', 21, '{inbox:view}'),
  ('inbox:delete', 'member', 22, '{inbox:view}'),
  ('inbox:operate', 'operate', 23, '{inbox:view}'),
  ('inbox:legalHold', 'manageMembers', 24, '{inbox:view}'),
  ('inbox:reasoning', 'manageMembers', 25, '{inbox:view}'),
  ('reviews:decide', 'member', 26, '{}'),
  ('helpDesks:view', 'member', 27, '{}'),
  ('helpDesks:edit', 'edit', 28, '{helpDesks:view}'),
  ('businessHours:view', 'member', 29, '{}'),
  ('businessHours:edit', 'edit', 30, '{businessHours:view}'),
  ('quickTexts:view', 'member', 31, '{}'),
  ('quickTexts:edit', 'edit', 32, '{quickTexts:view}'),
  ('improvements:view', 'member', 33, '{}'),
  ('improvements:edit', 'edit', 34, '{improvements:view}'),
  ('alerts:view', 'member', 35, '{}'),
  ('alerts:edit', 'edit', 36, '{alerts:view}'),
  ('goals:view', 'member', 37, '{}'),
  ('goals:edit', 'edit', 38, '{goals:view}'),
  ('insights:view', 'member', 39, '{}'),
  ('exports:schedule', 'edit', 40, '{insights:view}'),
  ('usage:view', 'manageMembers', 41, '{}'),
  ('audit:view', 'manageMembers', 42, '{}'),
  ('teammates:view', 'member', 43, '{}'),
  ('teammates:use', 'member', 44, '{teammates:view}'),
  ('teammates:edit', 'edit', 45, '{teammates:view}'),
  ('teammates:grants', 'manageMembers', 46, '{teammates:view}'),
  ('channels:use', 'member', 47, '{}'),
  ('channels:oversee', 'manageMembers', 48, '{}'),
  ('memories:view', 'member', 49, '{}'),
  ('memories:edit', 'edit', 50, '{memories:view}'),
  ('memories:settings', 'manageMembers', 51, '{memories:view}'),
  ('projects:view', 'member', 52, '{}'),
  ('projects:edit', 'edit', 53, '{projects:view}'),
  ('tasks:comment', 'member', 54, '{projects:view}'),
  ('organization:edit', 'manageMembers', 55, '{}'),
  ('providers:manage', 'manageMembers', 56, '{}'),
  ('crawlers:manage', 'manageMembers', 57, '{}'),
  ('billing:manage', 'manageMembers', 58, '{}'),
  ('personalSubscriptions:manage', 'changeRoles', 59, '{}'),
  ('members:view', 'edit', 60, '{}'),
  ('members:manage', 'manageMembers', 61, '{members:view}'),
  ('assistants:access', 'manageMembers', 62, '{members:view,assistants:view}'),
  ('roles:manage', 'manageMembers', 63, '{members:view}'),
  ('apiKeys:manage', 'manageApiKeys', 64, '{}'),
  ('mcpServers:manage', 'manageMembers', 65, '{}'),
  ('webhooks:manage', 'manageMembers', 66, '{}'),
  ('sso:manage', 'manageMembers', 67, '{}');

-- What a built-in holds by default: its old rung, Data Viewer a short list,
-- Owner everything. packages/core builtinRoleDefaults is the same rule, and
-- packages/db's custom-roles.security.test.ts holds the two together.
create or replace function private.builtin_role_defaults(p_key text)
returns text[] language sql stable set search_path = '' as $$
  select coalesce(array_agg(c.id order by c.position), '{}')
  from private.capability_catalog c
  where case p_key
    when 'owner' then true
    when 'admin' then c.tier <> 'changeRoles'
    when 'editor' then c.tier in ('member', 'operate', 'edit')
    when 'support_agent' then c.tier in ('member', 'operate')
    when 'viewer' then c.tier = 'member'
    when 'data_viewer' then c.id in ('assistants:view', 'insights:view')
    else false
  end
$$;

-- The ladder Role a Capability set sits at; never owner.
create or replace function private.capability_tier(p_capabilities text[])
returns public.org_role language sql stable set search_path = '' as $$
  select case
    when exists (select 1 from private.capability_catalog c where c.id = any(p_capabilities) and c.tier in ('publish','manageMembers','manageApiKeys','changeRoles')) then 'admin'::public.org_role
    when exists (select 1 from private.capability_catalog c where c.id = any(p_capabilities) and c.tier = 'edit') then 'editor'::public.org_role
    when exists (select 1 from private.capability_catalog c where c.id = any(p_capabilities) and c.tier = 'operate') then 'support_agent'::public.org_role
    else 'viewer'::public.org_role
  end
$$;

-- Roles ----------------------------------------------------------------------

create table public.org_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  key text check (key in ('owner','admin','editor','support_agent','viewer','data_viewer')),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  capabilities text[] not null default '{}',
  organization_level boolean not null default true,
  assistant_level boolean not null default false,
  -- A built-in whose Capabilities an admin changed. A release that adds a
  -- Capability updates only built-ins that are not customized.
  customized boolean not null default false,
  tier public.org_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  unique (organization_id, key),
  check (organization_level or assistant_level)
);

create unique index org_roles_org_name_idx on public.org_roles (organization_id, lower(btrim(name)));

comment on table public.org_roles is
  'A named set of Capabilities. key names a built-in; tier is the ladder Role RLS sees for its holders (ADR-0028).';

alter table public.organization_members add column role_id uuid references public.org_roles (id);
alter table public.organization_invites add column role_id uuid references public.org_roles (id);
alter table public.organization_api_keys add column role_id uuid references public.org_roles (id);

-- The caller's own Capabilities in one Organization: everything for an Owner
-- and a platform superuser, the Role's list for anyone else, none outside.
create or replace function private.member_capabilities(org uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select case
    when private.is_platform_superuser() then (select array_agg(id order by position) from private.capability_catalog)
    else coalesce((
      select case when r.key = 'owner' then (select array_agg(id order by position) from private.capability_catalog) else r.capabilities end
      from public.organization_members m
      join public.org_roles r on r.id = m.role_id
      where m.organization_id = org and m.user_id = (select auth.uid())
    ), '{}')
  end
$$;

-- Every Organization in which the caller holds a Capability. Policies use it
-- as `organization_id in (select private.orgs_with('x'))`, which runs once per
-- statement rather than once per row.
create or replace function private.orgs_with(p_capability text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select o.id from public.organizations o where private.is_platform_superuser()
  union
  select m.organization_id
  from public.organization_members m
  join public.org_roles r on r.id = m.role_id
  where m.user_id = (select auth.uid())
    and (r.key = 'owner' or p_capability = any(r.capabilities))
$$;

create or replace function private.has_capability(org uuid, p_capability text)
returns boolean language sql stable security definer set search_path = public as $$
  select org in (select private.orgs_with(p_capability))
$$;

-- Whether the caller is exempt from "hand on only what you hold": the service
-- role, a session with no user (migrations, cron), an Owner or a superuser.
create or replace function private.grants_unbounded(org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (select auth.uid()) is null
    or coalesce((select auth.jwt())->>'role', current_setting('request.jwt.claim.role', true), '') = 'service_role'
    or private.has_org_role(org, 4)
$$;

create or replace function private.assert_may_hand_on(org uuid, p_role_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare wanted text[];
begin
  if p_role_id is null or private.grants_unbounded(org) then return; end if;
  select case when key = 'owner' then private.builtin_role_defaults('owner') else capabilities end
    into wanted from public.org_roles where id = p_role_id;
  if not (wanted <@ private.member_capabilities(org)) then
    raise exception 'You cannot give a Role with Capabilities you do not hold' using errcode = '42501';
  end if;
end $$;

create or replace function private.normalize_org_role()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  unknown text;
  closed text[];
begin
  if tg_op = 'UPDATE' then
    new.key := old.key;
    new.organization_id := old.organization_id;
  end if;
  if new.key = 'owner' then
    -- Locked: every Capability, always, and the name it was seeded with.
    new.capabilities := private.builtin_role_defaults('owner');
    new.tier := 'owner';
    new.organization_level := true;
    new.assistant_level := false;
    new.customized := false;
    if tg_op = 'UPDATE' then
      new.name := old.name;
      new.description := old.description;
    end if;
    new.updated_at := now();
    return new;
  end if;

  select x into unknown from unnest(new.capabilities) x
  where not exists (select 1 from private.capability_catalog c where c.id = x) limit 1;
  if unknown is not null then
    raise exception 'Unknown capability %', unknown using errcode = '22023';
  end if;
  if exists (select 1 from private.capability_catalog c where c.id = any(new.capabilities) and c.tier = 'changeRoles') then
    raise exception 'That capability belongs to the Owner role alone' using errcode = '22023';
  end if;

  -- Closed over what each one requires, the way the editor and the
  -- operations close it, so a direct write saves a Role that works.
  loop
    select coalesce(array_agg(distinct x), '{}') into closed
    from (
      select unnest(new.capabilities) as x
      union
      select unnest(c.requires) from private.capability_catalog c where c.id = any(new.capabilities)
    ) s;
    exit when closed <@ new.capabilities;
    new.capabilities := closed;
  end loop;

  -- Catalogue order, no duplicates.
  new.capabilities := coalesce((
    select array_agg(c.id order by c.position) from private.capability_catalog c where c.id = any(new.capabilities)
  ), '{}');
  new.tier := private.capability_tier(new.capabilities);
  if new.key is not null then
    new.customized := new.capabilities is distinct from private.builtin_role_defaults(new.key);
  end if;

  -- A built-in is only ever inserted by seeding, for an Organization whose
  -- founder is not a member yet.
  if not (tg_op = 'INSERT' and new.key is not null) and not private.grants_unbounded(new.organization_id) then
    if not (new.capabilities <@ private.member_capabilities(new.organization_id)) then
      raise exception 'You cannot give a Role Capabilities you do not hold' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and exists (
      select 1 from public.organization_members m
      where m.organization_id = new.organization_id and m.user_id = (select auth.uid()) and m.role_id = new.id
    ) then
      raise exception 'You cannot edit the Role you hold' using errcode = '42501';
    end if;
  end if;

  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end $$;

create trigger org_roles_normalize
  before insert or update on public.org_roles
  for each row execute function private.normalize_org_role();

-- Seeding --------------------------------------------------------------------

create or replace function private.seed_builtin_roles(org uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.org_roles (organization_id, key, name, description, capabilities, organization_level, assistant_level)
  values
    (org, 'owner', 'Owner', 'Everything, including ownership and personal AI subscriptions. Cannot be edited.', '{}', true, false),
    (org, 'admin', 'Admin', 'Manages the Organization, its Members, Roles, API keys and integrations.', private.builtin_role_defaults('admin'), true, true),
    (org, 'editor', 'Editor', 'Builds and maintains Assistants, Flows, knowledge, Help Desks and Teammates.', private.builtin_role_defaults('editor'), true, true),
    (org, 'support_agent', 'Support Agent', 'Reads everything and answers Visitors from the Inbox.', private.builtin_role_defaults('support_agent'), true, false),
    (org, 'viewer', 'Viewer', 'Reads everything and changes nothing shared.', private.builtin_role_defaults('viewer'), true, true),
    (org, 'data_viewer', 'Data Viewer', 'Reads Insights and the Assistants they report on, nothing else.', private.builtin_role_defaults('data_viewer'), true, false)
  on conflict (organization_id, key) do nothing
$$;

create or replace function private.seed_builtin_roles_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform private.seed_builtin_roles(new.id);
  return new;
end $$;

create trigger organizations_seed_builtin_roles
  after insert on public.organizations
  for each row execute function private.seed_builtin_roles_trigger();

select private.seed_builtin_roles(id) from public.organizations;

-- Assignments ----------------------------------------------------------------


create index organization_members_role_id_idx on public.organization_members (role_id);
create index organization_invites_role_id_idx on public.organization_invites (role_id);
create index organization_api_keys_role_id_idx on public.organization_api_keys (role_id);

-- One body for the three tables: role_id is the truth, role its tier. A write
-- that moved only `role` (to a value the Role's tier is not) is a legacy
-- write of a built-in name, and lands on that built-in.
create or replace function private.sync_role_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r public.org_roles;
begin
  if tg_op = 'UPDATE' and new.role_id is not distinct from old.role_id and new.role is distinct from old.role then
    select * into r from public.org_roles where id = new.role_id;
    -- Compared as text: organization_api_keys.role is text, the others the enum.
    if r.id is null or r.tier::text is distinct from new.role::text then
      new.role_id := null;
    end if;
  end if;
  if new.role_id is null then
    select id into new.role_id from public.org_roles
    where organization_id = new.organization_id and key = new.role::text;
  end if;
  if new.role_id is null then
    return new;
  end if;
  select * into r from public.org_roles where id = new.role_id;
  if r.organization_id is distinct from new.organization_id then
    raise exception 'That Role belongs to another organization' using errcode = '22023';
  end if;
  if not r.organization_level then
    raise exception 'That Role is only available on Assistants' using errcode = '22023';
  end if;
  new.role := r.tier;
  if (tg_op = 'INSERT' or new.role_id is distinct from old.role_id)
     and coalesce(current_setting('ciele.detaching_role', true), '') <> 'on' then
    -- An invitee accepting, or a founder creating the Organization, is not
    -- yet a member and hands on nothing; everyone else is bounded.
    if exists (select 1 from public.organization_members m
               where m.organization_id = new.organization_id and m.user_id = (select auth.uid())) then
      perform private.assert_may_hand_on(new.organization_id, new.role_id);
    end if;
  end if;
  return new;
end $$;

create trigger organization_members_sync_role
  before insert or update on public.organization_members
  for each row execute function private.sync_role_assignment();
create trigger organization_invites_sync_role
  before insert or update on public.organization_invites
  for each row execute function private.sync_role_assignment();
create trigger organization_api_keys_sync_role
  before insert or update of role, role_id on public.organization_api_keys
  for each row execute function private.sync_role_assignment();

-- A Role edit moves its holders' tier in the same transaction.
create or replace function private.propagate_role_tier()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tier is distinct from old.tier then
    update public.organization_members set role = new.tier where role_id = new.id;
    update public.organization_invites set role = new.tier where role_id = new.id;
    update public.organization_api_keys set role = new.tier where role_id = new.id;
  end if;
  return null;
end $$;

create trigger org_roles_propagate_tier
  after update on public.org_roles
  for each row execute function private.propagate_role_tier();

-- Deleting a custom Role: what still points at it for the record (an accepted
-- invitation, a revoked key) falls back to the built-in of its tier, which
-- grants nothing because neither can act. A live holder keeps the foreign key
-- failing, and the Operation says who to move first.
create or replace function private.detach_deleted_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- A built-in is never deleted, by any caller, the service role included;
  -- only its Organization going takes it (the row is gone by then).
  if old.key is not null and exists (select 1 from public.organizations where id = old.organization_id) then
    return null;
  end if;
  perform set_config('ciele.detaching_role', 'on', true);
  update public.organization_invites set role_id = null where role_id = old.id and accepted_at is not null;
  update public.organization_api_keys set role_id = null where role_id = old.id and revoked_at is not null;
  perform set_config('ciele.detaching_role', '', true);
  return old;
end $$;

create trigger org_roles_detach_before_delete
  before delete on public.org_roles
  for each row execute function private.detach_deleted_role();

update public.organization_members m set role_id = r.id
from public.org_roles r where r.organization_id = m.organization_id and r.key = m.role::text and m.role_id is null;
update public.organization_invites i set role_id = r.id
from public.org_roles r where r.organization_id = i.organization_id and r.key = i.role::text and i.role_id is null;
update public.organization_api_keys k set role_id = r.id
from public.org_roles r where r.organization_id = k.organization_id and r.key = k.role::text and k.role_id is null;

-- An invitation carries its Role, not only its tier.
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
  insert into organization_members (organization_id, user_id, role, role_id)
  values (inv.organization_id, auth.uid(), inv.role, inv.role_id)
  on conflict (organization_id, user_id) do nothing;
  update organization_invites
  set accepted_by = auth.uid(), accepted_at = now()
  where id = inv.id;
  return inv.organization_id;
end $$;

-- Policies on the privilege tables -----------------------------------------

alter table public.org_roles enable row level security;
grant select, insert, update, delete on public.org_roles to authenticated;
grant all on public.org_roles to service_role;

create policy "members read roles" on public.org_roles
  for select using (private.is_org_member(organization_id));
create policy "role managers create roles" on public.org_roles
  for insert with check (key is null and organization_id in (select private.orgs_with('roles:manage')));
create policy "role managers edit roles" on public.org_roles
  for update using (organization_id in (select private.orgs_with('roles:manage')))
  with check (organization_id in (select private.orgs_with('roles:manage')));
-- Built-ins are never deleted; a held Role is refused by its foreign keys.
create policy "role managers delete custom roles" on public.org_roles
  for delete using (key is null and organization_id in (select private.orgs_with('roles:manage')));

drop policy if exists "admins add members, owners add owners" on public.organization_members;
create policy "member managers add members, owners add owners" on public.organization_members
  for insert with check (
    private.has_org_role(organization_id, 4)
    or (organization_id in (select private.orgs_with('members:manage')) and role <> 'owner')
  );
drop policy if exists "admins update roles, owners update owners" on public.organization_members;
create policy "member managers update roles, owners update owners" on public.organization_members
  for update
  using (
    private.has_org_role(organization_id, 4)
    or (organization_id in (select private.orgs_with('members:manage')) and role <> 'owner')
  )
  with check (
    private.has_org_role(organization_id, 4)
    or (organization_id in (select private.orgs_with('members:manage')) and role <> 'owner')
  );
drop policy if exists "admins remove members or self-leave" on public.organization_members;
create policy "member managers remove members or self-leave" on public.organization_members
  for delete using (
    private.has_org_role(organization_id, 4)
    or (organization_id in (select private.orgs_with('members:manage')) and role <> 'owner')
    or user_id = (select auth.uid())
  );

drop policy if exists "admins read invites" on public.organization_invites;
create policy "member managers read invites" on public.organization_invites
  for select using (organization_id in (select private.orgs_with('members:manage')));
drop policy if exists "admins create invites, owners invite owners" on public.organization_invites;
create policy "member managers create invites, owners invite owners" on public.organization_invites
  for insert with check (
    private.has_org_role(organization_id, 4)
    or (organization_id in (select private.orgs_with('members:manage')) and role <> 'owner')
  );
drop policy if exists "admins revoke invites" on public.organization_invites;
create policy "member managers revoke invites" on public.organization_invites
  for delete using (organization_id in (select private.orgs_with('members:manage')));

drop policy if exists "admins read api keys" on public.organization_api_keys;
create policy "key managers read api keys" on public.organization_api_keys
  for select using (organization_id in (select private.orgs_with('apiKeys:manage')));
drop policy if exists "admins create api keys" on public.organization_api_keys;
create policy "key managers create api keys" on public.organization_api_keys
  for insert with check (organization_id in (select private.orgs_with('apiKeys:manage')));
drop policy if exists "admins update api keys" on public.organization_api_keys;
create policy "key managers update api keys" on public.organization_api_keys
  for update using (organization_id in (select private.orgs_with('apiKeys:manage')));
drop policy if exists "admins delete revoked api keys" on public.organization_api_keys;
create policy "key managers delete revoked api keys" on public.organization_api_keys
  for delete using (
    organization_id in (select private.orgs_with('apiKeys:manage')) and revoked_at is not null
  );

-- Answering Visitors is a Capability now, not "Editor or Support Agent".
create or replace function private.can_operate_conversations(org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select private.has_capability(org, 'inbox:operate')
$$;

revoke all on function private.member_capabilities(uuid) from public, anon;
revoke all on function private.orgs_with(text) from public, anon;
revoke all on function private.has_capability(uuid, text) from public, anon;
grant execute on function private.member_capabilities(uuid) to authenticated, service_role;
grant execute on function private.orgs_with(text) to authenticated, service_role;
grant execute on function private.has_capability(uuid, text) to authenticated, service_role;

-- Assistant access is written by two Operations: Assistant access
-- (assistants:access) and a Member's Assistant scope (members:manage).
drop policy if exists "admins read assistant access" on public.assistant_access;
drop policy if exists "admins grant assistant access" on public.assistant_access;
drop policy if exists "admins update assistant access" on public.assistant_access;
drop policy if exists "admins revoke assistant access" on public.assistant_access;
create policy "access managers read assistant access" on public.assistant_access
  for select using (exists (
    select 1 from public.assistants a
    where a.id = assistant_access.assistant_id
      and (a.organization_id in (select private.orgs_with('assistants:access'))
        or a.organization_id in (select private.orgs_with('members:manage')))
  ));
create policy "access managers grant assistant access" on public.assistant_access
  for insert with check (exists (
    select 1 from public.assistants a
    where a.id = assistant_access.assistant_id
      and (a.organization_id in (select private.orgs_with('assistants:access'))
        or a.organization_id in (select private.orgs_with('members:manage')))
  ));
create policy "access managers update assistant access" on public.assistant_access
  for update using (exists (
    select 1 from public.assistants a
    where a.id = assistant_access.assistant_id
      and (a.organization_id in (select private.orgs_with('assistants:access'))
        or a.organization_id in (select private.orgs_with('members:manage')))
  ));
create policy "access managers revoke assistant access" on public.assistant_access
  for delete using (exists (
    select 1 from public.assistants a
    where a.id = assistant_access.assistant_id
      and (a.organization_id in (select private.orgs_with('assistants:access'))
        or a.organization_id in (select private.orgs_with('members:manage')))
  ));

-- Setting a Member's Assistant scope is members:manage, not the Admin rank.
create or replace function public.set_member_assistant_scope(
  p_organization_id uuid,
  p_user_id uuid,
  p_scope text,
  p_grants jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role public.org_role;
begin
  if coalesce((select auth.jwt())->>'role', current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and not private.has_capability(p_organization_id, 'members:manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_scope not in ('all', 'selected') then
    raise exception 'scope must be all or selected' using errcode = '22023';
  end if;
  select role into target_role
  from public.organization_members
  where organization_id = p_organization_id and user_id = p_user_id
  for update;
  if target_role is null then
    raise exception 'not a member of this organization' using errcode = 'P0002';
  end if;
  if target_role = 'owner' and p_scope = 'selected' then
    raise exception 'an owner always has access to every assistant' using errcode = '22023';
  end if;

  update public.organization_members
  set assistant_scope = p_scope
  where organization_id = p_organization_id and user_id = p_user_id;

  delete from public.assistant_access aa
  using public.assistants a
  where aa.assistant_id = a.id
    and a.organization_id = p_organization_id
    and aa.user_id = p_user_id;

  insert into public.assistant_access (assistant_id, user_id, role)
  select g.assistant_id, p_user_id, g.role::public.assistant_access_role
  from jsonb_to_recordset(coalesce(p_grants, '[]'::jsonb)) as g(assistant_id text, role text)
  join public.assistants a on a.id = g.assistant_id
  where a.organization_id = p_organization_id;
end $$;

-- Fences for a Role that holds part of what Admin holds -------------------
--
-- Before custom Roles, whoever could write these tables was an Admin and
-- held everything an Admin key or invitation could carry. A custom Role can
-- hold apiKeys:manage or members:manage alone, so the rows themselves must
-- not be a way to reach more.

-- Whether the caller may hand on a Role: an Owner, the service role, or a
-- holder of every Capability it carries.
create or replace function private.may_hand_on(org uuid, p_role_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare wanted text[];
begin
  if p_role_id is null or private.grants_unbounded(org) then return true; end if;
  select case when key = 'owner' then private.builtin_role_defaults('owner') else capabilities end
    into wanted from public.org_roles where id = p_role_id;
  return coalesce(wanted <@ private.member_capabilities(org), false);
end $$;

revoke all on function private.may_hand_on(uuid, uuid) from public, anon;
grant execute on function private.may_hand_on(uuid, uuid) to authenticated, service_role;

-- A key is a credential, not a record to edit: a session may revoke it and
-- touch its last use, never re-point its secret, its delegator or its
-- Organization, nor bring a revoked one back.
-- Both fences run as the invoker and apply only to `authenticated`, the role
-- PostgREST runs a Member's own token as. The service role, migrations and the
-- definer functions above (tier propagation, a Role's deletion) pass.
create or replace function private.fence_api_key_writes()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.created_by is distinct from (select auth.uid()) then
      raise exception 'An API key is created by the Member who mints it' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.secret_hash is distinct from old.secret_hash
     or new.created_by is distinct from old.created_by
     or new.organization_id is distinct from old.organization_id
     or new.role_id is distinct from old.role_id
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
     -- The tier moves only with its Role (org_roles_propagate_tier).
     or (new.role is distinct from old.role
         and new.role::text is distinct from (select r.tier::text from public.org_roles r where r.id = old.role_id)) then
    raise exception 'Only revoking and last use can change on an API key' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger organization_api_keys_fence
  before insert or update on public.organization_api_keys
  for each row execute function private.fence_api_key_writes();

-- A membership belongs to one person in one Organization: a session cannot
-- move a seat (and its Role) to another account.
create or replace function private.fence_member_identity()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if new.user_id is distinct from old.user_id or new.organization_id is distinct from old.organization_id then
    raise exception 'A membership cannot move to another account or Organization' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger organization_members_fence_identity
  before update on public.organization_members
  for each row execute function private.fence_member_identity();

-- An invitation's token is a grant of its Role: only someone who may hand
-- that Role on may read it, so nobody accepts their way above themselves.
drop policy if exists "member managers read invites" on public.organization_invites;
create policy "member managers read invites they could create" on public.organization_invites
  for select using (
    organization_id in (select private.orgs_with('members:manage'))
    and private.may_hand_on(organization_id, role_id)
  );
