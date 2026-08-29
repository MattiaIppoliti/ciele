-- Personal provider subscriptions stay on a Member's Mac. These server-only
-- tables relay opaque model invocations between Preview and that paired Mac;
-- provider credentials never enter Supabase.

alter table public.organizations
  add column if not exists allow_personal_ai_subscriptions boolean not null default false;

create table public.local_connector_pairings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique,
  origin text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.local_connector_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  origin text not null,
  providers jsonb not null default '[]'::jsonb,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index local_connector_devices_member_seen_idx
  on public.local_connector_devices (organization_id, user_id, last_seen_at desc)
  where revoked_at is null;

create table public.local_inference_jobs (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.local_connector_devices(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('openai', 'anthropic')),
  model_id text not null,
  invocation jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'completed', 'failed')),
  result jsonb,
  error text,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index local_inference_jobs_claim_idx
  on public.local_inference_jobs (device_id, status, created_at)
  where status = 'pending';

alter table public.local_connector_pairings enable row level security;
alter table public.local_connector_devices enable row level security;
alter table public.local_inference_jobs enable row level security;

-- Intentionally no client policies: only Ciele server routes use the service
-- role. Members and connectors authenticate through app sessions or hashed
-- one-time/device tokens, never with Supabase credentials.
