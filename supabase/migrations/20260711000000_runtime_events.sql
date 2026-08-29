-- Runtime telemetry sink (ADR-0011: AI observability within budget). One
-- privacy-safe, structured event per runtime boundary, the durable source of
-- truth for operational metrics (latency, tokens, tool calls, error outcomes)
-- without storing prompts, message text, retrieved chunks, model outputs, keys
-- or personal contact data. Written post-commit, isolated like the ai_usage
-- ledger: a telemetry failure never breaks or slows a user-visible turn.
--
-- The `kind` vocabulary reserves the ADR's full event set so later writers
-- (ingest jobs, cron sweeps) meter into the same table without a migration;
-- the first writer is the Conversation Turn (kind = 'chat_turn').

create table public.runtime_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  assistant_id text references public.assistants (id) on delete set null,
  conversation_id text,
  message_id text,
  kind text not null
    check (kind in ('chat_turn', 'llm_step', 'tool_call', 'retrieval', 'ingest_job', 'cron_sweep')),
  status text not null
    check (status in ('started', 'succeeded', 'failed')),
  -- Which traffic surface produced the event ('preview' / 'widget'); null for
  -- background work with no user surface (ingest jobs, cron sweeps).
  surface text
    check (surface is null or surface in ('preview', 'widget')),
  -- The provider/model that actually ran (post cross-provider fallback), and
  -- the credential kind used; null on the deterministic no-model path.
  provider text,
  model_id text,
  credential_kind text,
  -- The routed flow, when the event belongs to a chat turn.
  flow_id text,
  flow_name text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  -- Wall-clock duration of the boundary; null while a 'started' event is open.
  duration_ms integer,
  tool_calls integer not null default 0,
  retrieval_count integer not null default 0,
  -- Failure attribution (never silent). Error class + the same message already
  -- surfaced to the client; no prompts or model output are stored.
  error_class text,
  error_message text,
  -- Opaque ids for joining with an external OpenTelemetry trace backend.
  trace_id text,
  span_id text,
  created_at timestamptz not null default now()
);

create index runtime_events_org_created_idx
  on public.runtime_events (organization_id, created_at desc);
create index runtime_events_kind_status_idx
  on public.runtime_events (organization_id, kind, status, created_at desc);
create index runtime_events_conversation_idx
  on public.runtime_events (conversation_id);

alter table public.runtime_events enable row level security;

-- Members read their org's telemetry; members also insert (Preview turns run on
-- the session client). Published-widget turns insert via the service role.
create policy "members read runtime events" on public.runtime_events
  for select using (private.is_org_member(organization_id));
create policy "members record runtime events" on public.runtime_events
  for insert with check (private.is_org_member(organization_id));
