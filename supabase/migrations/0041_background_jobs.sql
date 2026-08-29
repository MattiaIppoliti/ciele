-- Durable job ledger for ingestion and later scheduled work. The Source stays
-- the user-facing state; this table is the retry/lock record that survives
-- function restarts.

create table if not exists public.background_jobs (
  id text primary key,
  kind text not null check (kind in ('ingest_source')),
  source_id text references public.sources (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  next_run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists background_jobs_due_idx
  on public.background_jobs (kind, status, next_run_at);
create index if not exists background_jobs_source_idx
  on public.background_jobs (source_id);

alter table public.background_jobs enable row level security;

drop policy if exists "members read source jobs" on public.background_jobs;
create policy "members read source jobs" on public.background_jobs
  for select using (exists (
    select 1
    from public.sources s
    join public.knowledge_collections kc on kc.id = s.collection_id
    join public.assistants a on a.id = kc.assistant_id
    where s.id = background_jobs.source_id
      and private.is_org_member(a.organization_id)
  ));

drop policy if exists "editors create source jobs" on public.background_jobs;
create policy "editors create source jobs" on public.background_jobs
  for insert with check (exists (
    select 1
    from public.sources s
    join public.knowledge_collections kc on kc.id = s.collection_id
    join public.assistants a on a.id = kc.assistant_id
    where s.id = background_jobs.source_id
      and private.has_org_role(a.organization_id, 2)
  ));

drop policy if exists "editors update source jobs" on public.background_jobs;
create policy "editors update source jobs" on public.background_jobs
  for update using (exists (
    select 1
    from public.sources s
    join public.knowledge_collections kc on kc.id = s.collection_id
    join public.assistants a on a.id = kc.assistant_id
    where s.id = background_jobs.source_id
      and private.has_org_role(a.organization_id, 2)
  ))
  with check (exists (
    select 1
    from public.sources s
    join public.knowledge_collections kc on kc.id = s.collection_id
    join public.assistants a on a.id = kc.assistant_id
    where s.id = background_jobs.source_id
      and private.has_org_role(a.organization_id, 2)
  ));
