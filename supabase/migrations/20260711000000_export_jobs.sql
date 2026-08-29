-- Async report exports (ADR-0010): a report is generated off the request path
-- by the durable job layer (ADR-0008) and lands in Insights -> Exports with a
-- status and a download link. This table is the durable ledger; the generated
-- file lives in a private Storage bucket and is served through a short-lived
-- signed URL only. Export files must never be public.

create table if not exists public.export_jobs (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('insights_overview')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'error')),
  format text not null default 'csv' check (format in ('csv')),
  -- Filter snapshot the worker replays against the reporting layer.
  params jsonb not null default '{}'::jsonb,
  storage_path text,
  error text not null default '',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists export_jobs_org_created_idx
  on public.export_jobs (organization_id, created_at desc);
create index if not exists export_jobs_due_idx
  on public.export_jobs (status, created_at);

alter table public.export_jobs enable row level security;

-- Any org member can request and read their org's exports: Insights is
-- viewer-visible, and an export is a read-derived artifact of it. The worker
-- runs as the service role and bypasses these policies.
drop policy if exists "members read export jobs" on public.export_jobs;
create policy "members read export jobs" on public.export_jobs
  for select using (private.is_org_member(organization_id));

drop policy if exists "members create export jobs" on public.export_jobs;
create policy "members create export jobs" on public.export_jobs
  for insert with check (private.is_org_member(organization_id));

drop policy if exists "members update export jobs" on public.export_jobs;
create policy "members update export jobs" on public.export_jobs
  for update using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

-- Atomic due-job claiming for the export runner. Claiming stamps the running
-- status + lock, so overlapping cron ticks never process the same job twice:
-- the second tick's SELECT ... FOR UPDATE SKIP LOCKED sees it as running and
-- non-stale and passes it over. A crashed run is reclaimed once its lock ages
-- past p_stale_before.
create or replace function public.claim_due_export_jobs(
  p_worker_id text,
  p_now timestamptz,
  p_stale_before timestamptz,
  p_limit integer
)
returns setof public.export_jobs
language sql
volatile
set search_path = public
as $$
  update public.export_jobs j
  set status = 'running',
      attempts = j.attempts + 1,
      locked_at = p_now,
      locked_by = p_worker_id,
      error = '',
      updated_at = p_now
  where j.id in (
    select id from public.export_jobs
    where (status = 'queued' and attempts < max_attempts)
       or (status = 'running' and locked_at is not null and locked_at < p_stale_before)
    order by created_at asc
    limit greatest(p_limit, 0)
    for update skip locked
  )
  returning j.*;
$$;

-- Private bucket for generated export artifacts. Path layout is org-scoped:
-- org/{organizationId}/exports/{jobId}.{ext}. Not public: reads go through a
-- signed URL and the org-membership select policy below; writes are the
-- service-role worker only (no insert/update policy on purpose).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'analytics-exports',
  'analytics-exports',
  false,
  52428800,
  array['text/csv']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "org members read analytics exports" on storage.objects;
create policy "org members read analytics exports"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'analytics-exports'
    and (storage.foldername(name))[1] = 'org'
    and exists (
      select 1
      from public.organization_members m
      where m.organization_id::text = (storage.foldername(name))[2]
        and m.user_id = auth.uid()
    )
  );
