-- Organization API keys (#618): org-scoped credentials for programmatic
-- access (the ciele CLI, MCP server and the upcoming /api/v1). Only the
-- SHA-256 hash of the secret is stored — the plaintext is shown once at
-- creation and never persisted. A key carries a Role, capped app-side at its
-- creator's, so a key can never out-rank the human who minted it. Revocation
-- is an update (revoked_at), not a delete, so the audit row survives.

create table public.organization_api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  secret_hash text not null unique,
  -- Displayable first characters of the secret (e.g. "ciele_sk_ab12").
  secret_hint text not null,
  -- 'owner' | 'admin' | 'editor' | 'viewer' — the Role the key acts with.
  role text not null default 'viewer',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists organization_api_keys_organization_id_idx
  on public.organization_api_keys (organization_id);

alter table public.organization_api_keys enable row level security;

-- Managing credentials is admin+ (rank 3), like members management. No
-- delete policy on purpose: revocation is an update.
create policy "admins read api keys" on public.organization_api_keys
  for select using (private.has_org_role(organization_id, 3));
create policy "admins create api keys" on public.organization_api_keys
  for insert with check (private.has_org_role(organization_id, 3));
create policy "admins update api keys" on public.organization_api_keys
  for update using (private.has_org_role(organization_id, 3));
