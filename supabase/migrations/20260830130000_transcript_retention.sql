-- Per-Organization transcript retention (#801, CYB-12).
--
-- The privacy page says organizations control how long conversations are kept.
-- What existed was `trace_retention_days` (#573), which strips the Thinking
-- trace and leaves the Conversation, its messages and its session metadata in
-- place forever, plus a per-conversation delete button. A button is not a
-- lifecycle: nothing expired on its own, so "we keep it as long as you say"
-- was true of the trace and of nothing else.
--
-- Same shape as the trace policy on purpose: a nullable window on the
-- organization, a sweep primitive the nightly cron calls, and null meaning
-- keep forever so no existing tenant's history starts disappearing without an
-- admin opting in.

alter table public.organizations
  add column if not exists transcript_retention_days integer
  check (transcript_retention_days is null or transcript_retention_days > 0);

comment on column public.organizations.transcript_retention_days is
  'Days a Conversation is kept before the nightly sweep deletes it, transcript and all. Null = keep forever.';

-- Legal hold: a conversation the organization must not delete yet, whatever
-- the retention window says. Set per conversation, and the sweep skips it, so
-- a preservation obligation does not require turning retention off for
-- everyone.
alter table public.conversations
  add column if not exists legal_hold boolean not null default false;

comment on column public.conversations.legal_hold is
  'Exempt from the retention sweep. Set while a conversation is under a preservation obligation.';

-- The sweep scans by age within one organization's assistants.
create index if not exists conversations_created_idx
  on public.conversations (created_at);

-- One statement per (organization, cutoff): deletes expired conversations and
-- reports how many rows it removed. Messages, feedback and improvement links
-- follow by cascade, which is what makes this a deletion rather than a
-- half-erasure that leaves the transcript reachable by id.
--
-- Idempotent: a deleted row never matches again. Security invoker, like the
-- other sweep primitives: the cron calls it on the service-role client, and an
-- RLS-scoped caller can only ever reach its own organization's conversations.
create or replace function public.delete_expired_conversations(
  p_organization_id uuid,
  p_cutoff timestamptz
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  deleted integer;
begin
  with expired as (
    select c.id
    from public.conversations c
    left join public.assistants a on a.id = c.assistant_id
    left join public.teammates t on t.id = c.teammate_id
    where coalesce(a.organization_id, t.organization_id) = p_organization_id
      and c.legal_hold = false
      and c.created_at < p_cutoff
  )
  delete from public.conversations c
  using expired
  where c.id = expired.id;
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;
