-- Sensitive-object access ledger (#801, CYB-05).
--
-- Knowledge originals and analytics exports were delivered as short-lived
-- signed URLs and nothing durable recorded who asked, from where, or whether
-- any bytes moved. Issuing a URL is not evidence that a download happened, so
-- this records the *transfer*: the app proxies the object and writes one row
-- per attempt, with the byte count it actually served.
--
-- Deliberately NOT `runtime_events`. That table's contract is telemetry with
-- no personal data, and any member may insert into it. An access ledger needs
-- the opposite of both: it carries IP and user agent, and a member must not be
-- able to write its own audit trail.
--
-- Append-only by absence: there is no update and no delete policy, so nothing
-- reaching this table through PostgREST can rewrite history. Inserts come from
-- the service role, which is the only writer.

create table public.object_access_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Who asked. A `member` carries the auth user id, an `api_key` the key id,
  -- a `visitor` the anonymous widget subject (Direct access, PRD #726).
  actor_kind text not null
    check (actor_kind in ('member', 'api_key', 'visitor', 'unknown')),
  actor_id text,
  object_kind text not null
    check (object_kind in ('knowledge_original', 'analytics_export')),
  -- The storage path, which is the object's identity. The Source it belongs to
  -- is kept beside it so an operator can answer "what was in that file".
  object_path text not null,
  source_id text,
  -- `served` means bytes reached the caller. `refused` is an authorization or
  -- policy no. `failed` is our side breaking, and is not a security event.
  result text not null check (result in ('served', 'refused', 'failed')),
  bytes bigint,
  ip text,
  user_agent text,
  -- Correlates with the request's own log line and any external trace.
  request_id text,
  created_at timestamptz not null default now()
);

create index object_access_events_org_created_idx
  on public.object_access_events (organization_id, created_at desc);
create index object_access_events_object_idx
  on public.object_access_events (organization_id, object_path, created_at desc);
create index object_access_events_actor_idx
  on public.object_access_events (organization_id, actor_kind, actor_id, created_at desc);

alter table public.object_access_events enable row level security;

-- Reading the ledger is an administrative act (rank 3), like reading API keys.
-- No insert, update or delete policy: the service role writes, nobody edits.
create policy "admins read object access events" on public.object_access_events
  for select using (private.has_org_role(organization_id, 3));
