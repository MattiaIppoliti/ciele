-- Limit a Member to some Assistants (Settings > Members > Assistants).
--
-- 20260716120000_assistant_access gives each Member an override per Assistant
-- (denied, viewer, editor, admin) that replaces their org Role there; no row
-- means the org Role. That cannot say "only these Assistants": a new
-- Assistant is visible to everyone who has not been denied it by name.
--
-- A Member's `assistant_scope` is now 'all' (the default, unchanged) or
-- 'selected'. A selected Member reaches only the Assistants they have a row
-- for, each at that row's Role; an Assistant with no row reads as denied. So
-- every place main already enforces a denied override (the Assistant row, the
-- knowledge policies, the service-role overlay) enforces the scope too, with
-- no second resolver. Owners are never limited.

alter table public.organization_members
  add column if not exists assistant_scope text not null default 'all'
    check (assistant_scope in ('all', 'selected'));

comment on column public.organization_members.assistant_scope is
  'all: the org Role on every Assistant, overrides aside. selected: only the Assistants with an assistant_access row.';

-- Same as 20260716120000, with one more case: a selected Member and no row.
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
          when aa.role is not null then public.assistant_access_rank(aa.role)
          when m.assistant_scope = 'selected' then 0
          else public.role_rank(m.role)
        end >= min_rank
    )
$$;

-- One Member's scope and every override row, in one transaction, so a
-- Member is never briefly limited to nothing while the rows are replaced.
-- Admin+ (or the service role), the same rank that manages overrides.
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
     and not private.has_org_role(p_organization_id, 3) then
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

revoke all on function public.set_member_assistant_scope(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.set_member_assistant_scope(uuid, uuid, text, jsonb) to authenticated, service_role;

-- A selected Member who creates an Assistant can reach it: without a row the
-- scope would hide it from the person who just made it. The row is at their
-- org Role (an Editor's is editor, an Admin's admin).
create or replace function private.grant_creator_assistant_access()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  creator public.organization_members;
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  select * into creator
  from public.organization_members
  where organization_id = new.organization_id and user_id = (select auth.uid());
  if creator.user_id is null or creator.role = 'owner' or creator.assistant_scope <> 'selected' then
    return new;
  end if;
  insert into public.assistant_access (assistant_id, user_id, role)
  values (
    new.id,
    creator.user_id,
    case creator.role when 'admin' then 'admin'::public.assistant_access_role
                      when 'editor' then 'editor'::public.assistant_access_role
                      else 'viewer'::public.assistant_access_role end
  )
  on conflict (assistant_id, user_id) do nothing;
  return new;
end $$;

drop trigger if exists assistants_grant_creator_access on public.assistants;
create trigger assistants_grant_creator_access
  after insert on public.assistants
  for each row execute function private.grant_creator_assistant_access();
