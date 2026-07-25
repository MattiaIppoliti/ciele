-- Widget SSO: an organization-level identity-provider connection so assistants
-- can require visitors to sign in before chatting (Entra ID first; clerk/workos
-- contract-ready). One connection per organization. The client secret in
-- `encrypted_secret` is AES-sealed app-side (see apps/web/src/lib/crypto.ts,
-- sealSecret) and never surfaced to the browser/widget.

create table public.sso_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique
    references public.organizations (id) on delete cascade,
  provider text not null check (provider in ('entra', 'clerk', 'workos')),
  -- Non-secret settings (Entra: { clientId, tenantId }).
  config jsonb not null default '{}'::jsonb,
  -- AES-256-GCM ciphertext of the client secret; NULL until a secret is set.
  encrypted_secret text,
  validation_status text not null default 'unvalidated'
    check (validation_status in ('unvalidated', 'valid', 'invalid')),
  validated_at timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sso_connections enable row level security;

-- Any org member may see that SSO is configured; only admins (rank >= 3) may
-- create/rotate/disconnect it, matching provider_connections' credential tier.
create policy "members read sso connections" on public.sso_connections
  for select using (private.is_org_member(organization_id));
create policy "admins insert sso connections" on public.sso_connections
  for insert with check (private.has_org_role(organization_id, 3));
create policy "admins update sso connections" on public.sso_connections
  for update using (private.has_org_role(organization_id, 3));
create policy "admins delete sso connections" on public.sso_connections
  for delete using (private.has_org_role(organization_id, 3));

-- Per-assistant enforcement flag (the credential lives once per org above).
alter table public.assistants
  add column require_sign_in boolean not null default false;
