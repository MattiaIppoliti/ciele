-- Deletion audit for the retention sweeps (#801, CYB-12).
--
-- The nightly sweep deleted expired Conversations and reported the counts to
-- the cron response, which nobody stores. A retention lifecycle whose only
-- evidence is a log line is not auditable: "what did the policy delete, and
-- when" must survive the deletion it describes.
--
-- Same posture as object_access_events: append-only by absence (no update or
-- delete policy), written by the service role the cron runs as, readable by
-- admins. Unlike that ledger this carries no personal data at all, only the
-- organization, the policy that ran, its window, and the row count, which is
-- precisely what makes it safe to keep after the transcripts are gone.

create table public.retention_sweep_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Which lifecycle ran: the transcript deletion (#801/CYB-12) or the older
  -- trace strip (#573). One table, because an operator asking "what did
  -- retention do last night" should not need to know our module boundaries.
  policy text not null check (policy in ('transcripts', 'traces')),
  retention_days integer not null,
  -- The cutoff the sweep computed; rows older than this were the target.
  cutoff timestamptz not null,
  -- Conversations deleted (transcripts) or messages stripped (traces).
  deleted integer,
  -- Present when the org's tick failed; `deleted` is null in that case.
  error text,
  created_at timestamptz not null default now()
);

create index retention_sweep_events_org_created_idx
  on public.retention_sweep_events (organization_id, created_at desc);

alter table public.retention_sweep_events enable row level security;

-- Reading the audit is an administrative act (rank 3), like the access ledger.
-- No insert, update or delete policy: the service role writes, nobody edits.
create policy "admins read retention sweep events" on public.retention_sweep_events
  for select using (private.has_org_role(organization_id, 3));
