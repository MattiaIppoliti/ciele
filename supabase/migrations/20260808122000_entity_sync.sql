-- Synced Record ingestion (#670): per-Entity REST/JSON sync sources and
-- per-run reports. Records stay fresh without CSV re-uploads, a durable
-- job fetches, maps, validates, upserts (same path as the CSV import) and
-- optionally prunes Records unseen in the run.

create table public.entity_sync_configs (
  entity_id text primary key references public.entities (id) on delete cascade,
  url text not null,
  -- Sealed JSON KeyValuePair[] (AES-GCM via APP_ENCRYPTION_KEY), like other
  -- stored secrets. Null = no auth headers.
  sealed_headers text,
  cadence_hours int not null default 24 check (cadence_hours >= 1),
  prune boolean not null default false,
  -- JSON field -> attribute key. Empty = match fields to attribute keys.
  mapping jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.entity_sync_runs (
  id text primary key,
  entity_id text not null references public.entities (id) on delete cascade,
  status text not null check (status in ('succeeded', 'failed')),
  upserted int not null default 0,
  pruned int not null default 0,
  -- Per-row rejection reports ("row 3: total is not a number"), jsonb string array.
  rejected jsonb not null default '[]'::jsonb,
  error text,
  finished_at timestamptz not null default now()
);

create index if not exists entity_sync_runs_entity_id_idx
  on public.entity_sync_runs (entity_id, finished_at desc);

alter table public.entity_sync_configs enable row level security;
alter table public.entity_sync_runs enable row level security;

create policy "members read entity sync configs" on public.entity_sync_configs
  for select using (exists (
    select 1 from public.entities e
    where e.id = entity_sync_configs.entity_id
      and private.is_org_member(e.organization_id)
  ));
create policy "editors write entity sync configs" on public.entity_sync_configs
  for insert with check (exists (
    select 1 from public.entities e
    where e.id = entity_sync_configs.entity_id
      and private.has_org_role(e.organization_id, 2)
  ));
create policy "editors update entity sync configs" on public.entity_sync_configs
  for update using (exists (
    select 1 from public.entities e
    where e.id = entity_sync_configs.entity_id
      and private.has_org_role(e.organization_id, 2)
  ));
create policy "editors delete entity sync configs" on public.entity_sync_configs
  for delete using (exists (
    select 1 from public.entities e
    where e.id = entity_sync_configs.entity_id
      and private.has_org_role(e.organization_id, 2)
  ));

create policy "members read entity sync runs" on public.entity_sync_runs
  for select using (exists (
    select 1 from public.entities e
    where e.id = entity_sync_runs.entity_id
      and private.is_org_member(e.organization_id)
  ));

-- New durable job kind for sync runs.
alter table public.background_jobs
  drop constraint if exists background_jobs_kind_check;

alter table public.background_jobs
  add constraint background_jobs_kind_check
  check (kind in (
    'ingest_source',
    'graph_sync_concept',
    'draft_improvement_proposal',
    'promote_memories',
    'sync_entity_records'
  ));
