-- Crawler Connections: an Organization's own account on a remote crawler
-- (Settings → Crawling). One row per (organization, provider); today the only
-- provider is Apify. When a row exists, that provider's crawls for the
-- Organization start and poll on this token instead of the platform's
-- APIFY_API_TOKEN, so the crawl bills the Organization's own account.
--
-- `encrypted_token` is AES-sealed app-side (packages/core/src/crypto.ts,
-- sealSecret) and never leaves the server.

create table public.crawler_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  provider text not null check (provider in ('apify')),
  encrypted_token text not null,
  token_hint text not null default '',
  account_id text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);

alter table public.crawler_connections enable row level security;

-- Every member may read: the crawl finalizer runs on whichever member's poll
-- has the Knowledge tab open, and it has to reach the token the run started
-- on. The token itself is sealed, so a read discloses a hint, not a secret.
-- Only admins (rank >= 3) connect, rotate or remove one, the same tier as
-- provider_connections and sso_connections.
create policy "members read crawler connections" on public.crawler_connections
  for select using (private.is_org_member(organization_id));
create policy "admins insert crawler connections" on public.crawler_connections
  for insert with check (private.has_org_role(organization_id, 3));
create policy "admins update crawler connections" on public.crawler_connections
  for update using (private.has_org_role(organization_id, 3));
create policy "admins delete crawler connections" on public.crawler_connections
  for delete using (private.has_org_role(organization_id, 3));
