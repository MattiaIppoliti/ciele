-- Data retention per data type: the Settings "Data retention" tab.
--
-- One window per data type. Conversations keep the existing
-- `transcript_retention_days` (#801, CYB-12); this adds Messages, Improvements
-- and audit records. The new windows keep the shape every earlier policy has:
-- a nullable window on the organization (null = keep forever, so nothing
-- starts disappearing until an admin opts in), a bounded sweep primitive the
-- nightly cron calls, and a row in `retention_sweep_events` per tick. Deletion
-- is a real delete, like the Conversation sweep.
--
-- Audit records were already swept, at a fixed 180 days inside
-- `sweep_runtime_ledgers` (20261023080000_configuration_audit). That window is
-- now the organization's `audit_retention_days`, default 180, so nothing
-- changes for an Organization that never opens the tab.

-- 1. The windows ------------------------------------------------------------

-- One month to five years, the bounds packages/core enforces
-- (`RETENTION_MIN_DAYS` / `RETENTION_MAX_DAYS`). `transcript_retention_days`
-- keeps its looser check so no existing row violates a constraint; the
-- operation layer applies the bounds to new writes.
alter table public.organizations
  add column if not exists message_retention_days integer
    check (message_retention_days is null or message_retention_days between 30 and 1825),
  add column if not exists improvement_retention_days integer
    check (improvement_retention_days is null or improvement_retention_days between 30 and 1825),
  add column if not exists audit_retention_days integer not null default 180
    check (audit_retention_days between 30 and 1825);

comment on column public.organizations.message_retention_days is
  'Days a message is kept before the nightly sweep deletes it from a Conversation that stays. Null = keep forever.';
comment on column public.organizations.improvement_retention_days is
  'Days an Improvement may go without an update before the nightly sweep deletes it, whatever its status. Null = keep forever.';
comment on column public.organizations.audit_retention_days is
  'Days an audit log entry is kept. Always enforced; there is no keep-forever setting.';

-- The Inbox says "earlier messages were deleted" from this, rather than
-- leaving a transcript that starts mid-conversation with no explanation.
-- Written by the sweep only; it never moves `updated_at`, which is the
-- Conversation's own retention clock.
alter table public.conversations
  add column if not exists messages_deleted_through timestamptz;

comment on column public.conversations.messages_deleted_through is
  'Creation time of the newest message the retention sweep deleted from this Conversation. Null = none deleted.';

create index if not exists messages_created_at_idx on public.messages (created_at);
create index if not exists improvements_org_updated_idx
  on public.improvements (organization_id, updated_at);

-- The sweep ledger learns the new policies.
alter table public.retention_sweep_events
  drop constraint if exists retention_sweep_events_policy_check;
alter table public.retention_sweep_events
  add constraint retention_sweep_events_policy_check
  check (policy in ('transcripts', 'traces', 'messages', 'improvements'));

-- 2. Sweep primitives ---------------------------------------------------------

-- Deletes up to p_limit of one Organization's messages created before the
-- cutoff, oldest first, skipping Conversations under legal hold, and stamps
-- each touched Conversation. Feedback, verdicts and Improvement links follow
-- by cascade; the Improvement itself stays.
create or replace function public.delete_expired_messages(
  p_organization_id uuid,
  p_cutoff timestamptz,
  p_limit integer default 5000
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
    select m.id, m.conversation_id, m.created_at
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    left join public.assistants a on a.id = c.assistant_id
    left join public.teammates t on t.id = c.teammate_id
    where coalesce(a.organization_id, t.organization_id) = p_organization_id
      and c.legal_hold = false
      and m.created_at < p_cutoff
    order by m.created_at
    limit greatest(p_limit, 1)
  ),
  gone as (
    delete from public.messages m
    using expired e
    where m.id = e.id
    returning e.conversation_id, e.created_at
  ),
  marked as (
    update public.conversations c
    set messages_deleted_through = greatest(
      coalesce(c.messages_deleted_through, '-infinity'::timestamptz),
      g.newest
    )
    from (
      select conversation_id, max(created_at) as newest
      from gone
      group by conversation_id
    ) g
    where c.id = g.conversation_id
    returning 1
  )
  select count(*) into deleted from gone;
  return deleted;
end;
$$;

comment on function public.delete_expired_messages(uuid, timestamptz, integer) is
  'Deletes up to p_limit of one Organization''s messages created before the cutoff, oldest first, skipping legal holds, and records the newest deleted time on each Conversation. Idempotent; call again until it returns less than p_limit.';

create or replace function public.delete_expired_improvements(
  p_organization_id uuid,
  p_cutoff timestamptz,
  p_limit integer default 5000
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
    select i.id
    from public.improvements i
    where i.organization_id = p_organization_id
      and i.updated_at < p_cutoff
    order by i.updated_at
    limit greatest(p_limit, 1)
  )
  delete from public.improvements i
  using expired
  where i.id = expired.id;
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

comment on function public.delete_expired_improvements(uuid, timestamptz, integer) is
  'Deletes up to p_limit of one Organization''s Improvements not updated since the cutoff, whatever their status, oldest first. Idempotent; call again until it returns less than p_limit.';

-- Only the nightly sweep calls these. A Member deletes a Conversation through
-- its own operation, never by moving a cutoff.
revoke all on function public.delete_expired_messages(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.delete_expired_messages(uuid, timestamptz, integer) to service_role;
revoke all on function public.delete_expired_improvements(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.delete_expired_improvements(uuid, timestamptz, integer) to service_role;

-- 3. Audit records follow the organization's window ----------------------------

-- Same body as the 20261023080000 wrapper, with the fixed 180 days replaced by
-- each organization's own window. Still bounded per call, oldest first.
create or replace function public.sweep_runtime_ledgers(p_now timestamptz default now(),p_limit integer default 1000)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  result := public.sweep_runtime_ledgers_before_audit(p_now,p_limit);
  delete from public.audit_log where id in (
    select a.id from public.audit_log a
    join public.organizations o on o.id = a.organization_id
    where a.created_at < p_now - make_interval(days => o.audit_retention_days)
    order by a.created_at, a.id
    limit greatest(0,least(p_limit,5000))
  );
  return result;
end $$;
revoke all on function public.sweep_runtime_ledgers(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.sweep_runtime_ledgers(timestamptz,integer) to service_role;
