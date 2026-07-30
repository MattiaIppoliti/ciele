-- API catalogue integration (spec #559): one integration per Assistant — a base
-- URL, one sealed credential, and a catalogue of described endpoints — which the
-- model reaches through three generic discovery/query tools instead of one
-- hand-registered custom tool per endpoint.
--
-- Why its own table rather than another key in `assistants.tools`: that jsonb is
-- snapshotted into every Publication and served to widget clients. A credential
-- must never be able to travel that path, so it lives here, read only by
-- server-side callers through `Db.getApiIntegration`.

create table public.assistant_api_integrations (
  assistant_id text primary key references public.assistants (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null default '',
  base_url text not null,
  -- 'none' | 'bearer' | 'api_key' | 'basic' (ApiIntegrationAuthType).
  auth_type text not null default 'none',
  -- Header the API key goes in (api_key auth only).
  auth_header_name text not null default '',
  -- Username (basic auth only); the password is the sealed credential.
  auth_username text not null default '',
  -- Sealed app-side with sealSecret; this schema never sees plaintext.
  encrypted_credential text,
  -- ApiEndpointSpec[] — see packages/core/src/types.ts.
  endpoints jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assistant_api_integrations_organization_id_idx
  on public.assistant_api_integrations (organization_id);

alter table public.assistant_api_integrations enable row level security;

-- Read is org-member; writing an integration (and therefore a credential and an
-- egress allow-list) is editor and above, like every other assistant config.
create policy "members read api integrations" on public.assistant_api_integrations
  for select using (private.is_org_member(organization_id));
create policy "editors create api integrations" on public.assistant_api_integrations
  for insert with check (private.has_org_role(organization_id, 2));
create policy "editors update api integrations" on public.assistant_api_integrations
  for update using (private.has_org_role(organization_id, 2));
create policy "editors delete api integrations" on public.assistant_api_integrations
  for delete using (private.has_org_role(organization_id, 2));
