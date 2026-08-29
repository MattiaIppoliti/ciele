-- Application Connection ownership follows the external account. Institutional
-- systems belong to the Organization; personal drives belong to the Member who
-- authorized them. Existing personal grants cannot be attributed safely, so
-- they are paused until an Admin reconnects them under an explicit Member.

alter table public.application_connections
  add column owner_type text not null default 'organization'
    check (owner_type in ('organization', 'member')),
  add column owner_member_id uuid;

alter table public.application_connections
  add constraint application_connections_owner_shape_check
  check (
    (owner_type = 'organization' and owner_member_id is null)
    or (owner_type = 'member' and owner_member_id is not null)
  ),
  add constraint application_connections_owner_member_fk
  foreign key (organization_id, owner_member_id)
  references public.organization_members (organization_id, user_id)
  on delete cascade;

update public.application_connections
set status = 'reauthorization_required',
    error = 'Reconnect this personal Application to assign it to a Member',
    updated_at = now()
where provider in ('onedrive', 'google_drive');

create unique index application_connections_organization_provider_uidx
  on public.application_connections (organization_id, provider)
  where owner_type = 'organization'
    and provider in ('salesforce', 'servicenow', 'slack');
create unique index application_connections_member_provider_uidx
  on public.application_connections (organization_id, owner_member_id, provider)
  where owner_type = 'member';
create index application_connections_owner_member_fk_idx
  on public.application_connections (organization_id, owner_member_id)
  where owner_member_id is not null;

-- The view deliberately owns the base-table read: Members may inspect safe
-- connection metadata without ever selecting sealed_credentials. Personal
-- Connections are visible only to their owner and Organization Admins.
create or replace view public.application_connections_safe
with (security_barrier = true)
as
select id, organization_id, provider, name, status, scopes,
  provider_account_id, metadata, error, last_connected_at, created_at, updated_at,
  owner_type, owner_member_id
from public.application_connections
where private.is_org_member(organization_id)
  and (
    (owner_type = 'organization'
      and provider in ('salesforce', 'servicenow', 'slack'))
    or owner_member_id = (select auth.uid())
    or private.has_org_role(organization_id, 3)
  );
revoke all on public.application_connections_safe from public;
grant select on public.application_connections_safe to authenticated;

drop policy if exists "admins create own application oauth nonce"
  on public.application_oauth_nonces;
create policy "editors create own application oauth nonce"
  on public.application_oauth_nonces for insert
  to authenticated
  with check (
    member_id = (select auth.uid())
    and private.has_org_role(organization_id, 2)
  );

create or replace function public.consume_application_oauth_nonce(
  p_nonce text,
  p_organization_id uuid,
  p_member_id uuid,
  p_consumed_at timestamptz
) returns boolean
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is distinct from p_member_id
    or not private.has_org_role(p_organization_id, 2)
  then
    return false;
  end if;
  update public.application_oauth_nonces
  set consumed_at = p_consumed_at
  where nonce = p_nonce
    and organization_id = p_organization_id
    and member_id = p_member_id
    and consumed_at is null
    and expires_at > p_consumed_at;
  return found;
end
$$;
revoke all on function public.consume_application_oauth_nonce(text, uuid, uuid, timestamptz) from public;
grant execute on function public.consume_application_oauth_nonce(text, uuid, uuid, timestamptz)
  to authenticated, service_role;
