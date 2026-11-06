-- Assistant-level Roles and the default Roles (map #1164, ADR-0028).
--
-- 1. An assistant_access row may name a Role (role_id), one available at
--    Assistant level. Its `role` column stays and becomes that Role's tier on
--    the Assistant (admin / editor / viewer), kept by trigger, so
--    private.has_assistant_role and every policy built on it keep working.
--    A legacy write of viewer / editor / admin lands on that built-in, so an
--    edited built-in Editor is what an "editor" row means. `denied` names no
--    Role.
-- 2. One Role per Organization is the default for invitations
--    (member_default) and one the default for an Assistant assignment
--    (assistant_default). Editor and Viewer start as the defaults, which is
--    what the console offered before.

alter table public.assistant_access add column role_id uuid references public.org_roles (id);
create index assistant_access_role_id_idx on public.assistant_access (role_id);

create or replace function private.assistant_access_tier(p_tier public.org_role)
returns public.assistant_access_role language sql immutable set search_path = '' as $$
  select case p_tier
    when 'owner' then 'admin'::public.assistant_access_role
    when 'admin' then 'admin'::public.assistant_access_role
    when 'editor' then 'editor'::public.assistant_access_role
    else 'viewer'::public.assistant_access_role
  end
$$;

create or replace function private.sync_assistant_access_role()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r public.org_roles;
  org uuid;
begin
  select organization_id into org from public.assistants where id = new.assistant_id;
  if tg_op = 'UPDATE' and new.role_id is not distinct from old.role_id and new.role is distinct from old.role then
    -- A write of the enum alone: a legacy writer, or tier propagation.
    select * into r from public.org_roles where id = new.role_id;
    if r.id is null or private.assistant_access_tier(r.tier) is distinct from new.role then
      new.role_id := null;
    end if;
  end if;
  if new.role = 'denied' then
    new.role_id := null;
    return new;
  end if;
  if new.role_id is null then
    select id into new.role_id from public.org_roles
    where organization_id = org and key = new.role::text;
  end if;
  if new.role_id is null then
    return new;
  end if;
  select * into r from public.org_roles where id = new.role_id;
  if r.organization_id is distinct from org then
    raise exception 'That Role belongs to another organization' using errcode = '22023';
  end if;
  if not r.assistant_level then
    raise exception 'That Role is not available on Assistants' using errcode = '22023';
  end if;
  new.role := private.assistant_access_tier(r.tier);
  if (tg_op = 'INSERT' or new.role_id is distinct from old.role_id)
     and coalesce(current_setting('ciele.detaching_role', true), '') <> 'on' then
    perform private.assert_may_hand_on(org, new.role_id);
  end if;
  return new;
end $$;

create trigger assistant_access_sync_role
  before insert or update on public.assistant_access
  for each row execute function private.sync_assistant_access_role();

update public.assistant_access aa set role_id = r.id
from public.assistants a, public.org_roles r
where a.id = aa.assistant_id and r.organization_id = a.organization_id
  and r.key = aa.role::text and aa.role <> 'denied' and aa.role_id is null;

-- A Role's edit moves its Assistant assignments' tier too.
create or replace function private.propagate_role_tier()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tier is distinct from old.tier then
    update public.organization_members set role = new.tier where role_id = new.id;
    update public.organization_invites set role = new.tier where role_id = new.id;
    update public.organization_api_keys set role = new.tier where role_id = new.id;
    update public.assistant_access set role = private.assistant_access_tier(new.tier) where role_id = new.id;
  end if;
  return null;
end $$;

-- A Role no longer offered on Assistants cannot keep Assistant assignments.
create or replace function private.guard_assistant_level()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.assistant_level and not new.assistant_level
     and exists (select 1 from public.assistant_access where role_id = new.id) then
    raise exception 'This Role is given on Assistants; move those assignments first' using errcode = '23503';
  end if;
  return new;
end $$;

create trigger org_roles_guard_assistant_level
  before update of assistant_level on public.org_roles
  for each row execute function private.guard_assistant_level();

-- The per-Member writer takes the Role too.
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

  insert into public.assistant_access (assistant_id, user_id, role, role_id)
  select g.assistant_id, p_user_id, coalesce(g.role, 'viewer')::public.assistant_access_role, g.role_id
  from jsonb_to_recordset(coalesce(p_grants, '[]'::jsonb)) as g(assistant_id text, role text, role_id uuid)
  join public.assistants a on a.id = g.assistant_id
  where a.organization_id = p_organization_id;
end $$;

-- Default Roles --------------------------------------------------------------

alter table public.org_roles
  add column member_default boolean not null default false,
  add column assistant_default boolean not null default false;

create unique index org_roles_one_member_default on public.org_roles (organization_id) where member_default;
create unique index org_roles_one_assistant_default on public.org_roles (organization_id) where assistant_default;

update public.org_roles set member_default = true where key = 'editor';
update public.org_roles set assistant_default = true where key = 'viewer';

-- Moving a default flag is not an edit of the Role (20261104140000's body,
-- with that one case added).
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
  -- founder is not a member yet. Moving a default flag changes nothing a
  -- holder may do, so it is not an edit of the Role either.
  if not (tg_op = 'INSERT' and new.key is not null)
     and not (tg_op = 'UPDATE'
       and (new.name, new.description, new.capabilities, new.organization_level, new.assistant_level)
         is not distinct from (old.name, old.description, old.capabilities, old.organization_level, old.assistant_level))
     and not private.grants_unbounded(new.organization_id) then
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

create or replace function private.guard_role_defaults()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.member_default and (new.key = 'owner' or not new.organization_level) then
    raise exception 'The invitation default must be a Role offered Organization-wide, not Owner' using errcode = '22023';
  end if;
  if new.assistant_default and not new.assistant_level then
    raise exception 'The Assistant default must be a Role offered on Assistants' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger org_roles_guard_defaults
  before insert or update on public.org_roles
  for each row execute function private.guard_role_defaults();

-- New Organizations start with the same two defaults.
create or replace function private.seed_builtin_roles_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform private.seed_builtin_roles(new.id);
  update public.org_roles set member_default = true where organization_id = new.id and key = 'editor';
  update public.org_roles set assistant_default = true where organization_id = new.id and key = 'viewer';
  return new;
end $$;

-- Moving a default is two writes on two rows; one function makes it one.
create or replace function public.set_role_defaults(
  p_organization_id uuid,
  p_member_role_id uuid,
  p_assistant_role_id uuid
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce((select auth.jwt())->>'role', current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and not private.has_capability(p_organization_id, 'roles:manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_member_role_id is not null then
    if not exists (select 1 from public.org_roles where id = p_member_role_id and organization_id = p_organization_id) then
      raise exception 'Role not found' using errcode = 'P0002';
    end if;
    update public.org_roles set member_default = false where organization_id = p_organization_id and member_default and id <> p_member_role_id;
    update public.org_roles set member_default = true where id = p_member_role_id;
  end if;
  if p_assistant_role_id is not null then
    if not exists (select 1 from public.org_roles where id = p_assistant_role_id and organization_id = p_organization_id) then
      raise exception 'Role not found' using errcode = 'P0002';
    end if;
    update public.org_roles set assistant_default = false where organization_id = p_organization_id and assistant_default and id <> p_assistant_role_id;
    update public.org_roles set assistant_default = true where id = p_assistant_role_id;
  end if;
end $$;

revoke all on function public.set_role_defaults(uuid, uuid, uuid) from public, anon;
grant execute on function public.set_role_defaults(uuid, uuid, uuid) to authenticated, service_role;

-- A row is one Member's Role on one Assistant: a session cannot move it to
-- another Member or another Assistant, which would hand that Role on without
-- the check above (review of #1164).
create or replace function private.fence_assistant_access_identity()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if new.user_id is distinct from old.user_id or new.assistant_id is distinct from old.assistant_id then
    raise exception 'An Assistant access row cannot move to another member or Assistant' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger assistant_access_fence_identity
  before update on public.assistant_access
  for each row execute function private.fence_assistant_access_identity();

-- A Member reads their own rows: the console resolves their Role on an
-- Assistant through their own session, and without this it read nothing and
-- fell back to the Organization Role.
create policy "members read their own assistant access" on public.assistant_access
  for select using (user_id = (select auth.uid()));
