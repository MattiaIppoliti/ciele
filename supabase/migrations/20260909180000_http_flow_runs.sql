-- Inbound runs of an HTTP-triggered Flow (ticket ciele-org#843).
--
-- A run is deliberately not a Conversation: a machine-to-machine call has no
-- Visitor, and a Conversation for it would enter the Inbox and the Insights
-- population ADR-0010 keeps for people. So the record is its own row, one per
-- call, written by the runtime after the caller has been answered and read from
-- the trigger's own panel in the Flow Builder.
--
-- It keeps what an operator needs to diagnose a silent or failing endpoint:
-- which actions ran, what the caller was told, how long it took, and which
-- action threw. It never keeps the request body or the response body. Those
-- may carry the caller's data, and an archive of them is not what this is.

create table public.http_flow_runs (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  assistant_id text not null references public.assistants (id) on delete cascade,
  -- No foreign key: a run of a Flow that was later deleted is still a fact
  -- about the endpoint, and the panel it is read from is gone with the Flow.
  flow_id text not null,
  -- The Publication the Flow was read from; null for a run recorded before the
  -- published requirement, or on the mock.
  publication_id text,
  method text not null,
  status integer not null,
  ran jsonb not null default '[]'::jsonb,
  failed_action text,
  failed_message text,
  duration_ms integer not null default 0 check (duration_ms >= 0),
  created_at timestamptz not null default now()
);

-- The panel's read: the latest runs of one Flow.
create index http_flow_runs_flow_created_idx
  on public.http_flow_runs (flow_id, created_at desc);
create index http_flow_runs_org_idx
  on public.http_flow_runs (organization_id);

alter table public.http_flow_runs enable row level security;

-- Reading is a Member right: the run is part of the Flow's own diagnostics.
-- There is deliberately NO member write policy. The runtime writes through the
-- system Db after answering the caller; a run is a record of what happened,
-- and a row a Member could insert or edit would be a record of nothing.
create policy "members read http flow runs" on public.http_flow_runs
  for select using (private.is_org_member(organization_id));

comment on table public.http_flow_runs is
  'Inbound HTTP Flow runs (#843): one row per call, written by the runtime, never a Conversation.';
comment on column public.http_flow_runs.ran is
  'The Flow actions that ran, in order, as a JSON array of action names.';
