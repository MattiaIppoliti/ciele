-- Per-Organization trace retention (#573) — the policy layer #557 left open.
--
-- A persisted Turn Trace is the sensitive part of a transcript: reasoning and
-- tool results quote the Visitor's messages and retrieved knowledge verbatim
-- (student names and grades appear in the reference platform's own payloads).
-- This adds the retention window an admin sets and the sweep primitive the
-- cron drain calls to enforce it.
--
-- Null (the default) keeps traces forever: an existing tenant's transcripts
-- must never start disappearing without an admin opting in. The sweep strips
-- ONLY the trace payload — the message, its content, feedback and timestamps
-- stay, so the Inbox keeps the bubble and simply renders no Thinking panel.

alter table public.organizations
  add column if not exists trace_retention_days integer
  check (trace_retention_days is null or trace_retention_days > 0);

comment on column public.organizations.trace_retention_days is
  'Days a message keeps its Thinking-Steps trace before the cron sweep strips it. Null = keep forever.';

-- The sweep scans by age among traced messages only; everything else in the
-- table is invisible to this index.
create index if not exists messages_traced_created_idx
  on public.messages (created_at)
  where trace is not null;

-- One statement per (organization, cutoff): clears expired traces and reports
-- how many rows it touched. Idempotent — a cleared trace is null and never
-- matches again. Security invoker, like the other sweep primitives: the cron
-- calls it on the service-role client; an RLS-scoped caller can only ever
-- reach its own organization's messages.
create or replace function public.clear_expired_traces(
  p_organization_id uuid,
  p_cutoff timestamptz
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  cleared integer;
begin
  update public.messages m
  set trace = null
  from public.conversations c, public.assistants a
  where m.conversation_id = c.id
    and c.assistant_id = a.id
    and a.organization_id = p_organization_id
    and m.trace is not null
    and m.created_at < p_cutoff;
  get diagnostics cleared = row_count;
  return cleared;
end;
$$;
