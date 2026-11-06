-- Public connection definitions and service-only sealed credentials never share a row.
create table public.mcp_server_connections (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  url text not null,
  revision integer not null default 1,
  tools jsonb not null default '[]' check (jsonb_typeof(tools) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index mcp_server_connections_organization_idx on public.mcp_server_connections (organization_id);
alter table public.mcp_server_connections enable row level security;
revoke all on public.mcp_server_connections from anon, authenticated;
grant select, delete on public.mcp_server_connections to authenticated;
grant update (name, tools, revision, updated_at) on public.mcp_server_connections to authenticated;
create policy mcp_servers_read on public.mcp_server_connections for select to authenticated
  using (private.is_org_member(organization_id));
create policy mcp_servers_update on public.mcp_server_connections for update to authenticated
  using (private.has_org_role(organization_id, 3)) with check (private.has_org_role(organization_id, 3));
create policy mcp_servers_delete on public.mcp_server_connections for delete to authenticated
  using (private.has_org_role(organization_id, 3));

create table public.mcp_server_secrets (
  id text primary key references public.mcp_server_connections(id) on delete cascade,
  encrypted_token text not null
);
alter table public.mcp_server_secrets enable row level security;
revoke all on public.mcp_server_secrets from anon, authenticated;
grant all on public.mcp_server_connections, public.mcp_server_secrets to service_role;

create function public.create_mcp_server_connection(
  p_id text, p_organization_id uuid, p_name text, p_url text, p_tools jsonb, p_encrypted_token text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result public.mcp_server_connections;
begin
  if auth.role() is distinct from 'service_role' and not coalesce(private.has_org_role(p_organization_id, 3), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  insert into public.mcp_server_connections (id, organization_id, name, url, tools)
    values (p_id, p_organization_id, p_name, p_url, p_tools) returning * into result;
  if p_encrypted_token is not null then
    insert into public.mcp_server_secrets (id, encrypted_token) values (p_id, p_encrypted_token);
  end if;
  return to_jsonb(result);
end $$;
revoke all on function public.create_mcp_server_connection(text,uuid,text,text,jsonb,text) from public;
grant execute on function public.create_mcp_server_connection(text,uuid,text,text,jsonb,text) to authenticated, service_role;
