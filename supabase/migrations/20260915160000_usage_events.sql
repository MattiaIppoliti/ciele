-- Non-model operations, at rate zero (#854, spec #847).
--
-- The API request and Send email Flow actions, HTTP flow runs and outbound
-- webhooks all make real outbound calls and are invisible to every ledger. Their
-- platform cost is genuinely near zero, which is why they were never metered,
-- but "near zero" is an assumption nothing can confirm, and the same absence is
-- what would stop a rate from being applied later from evidence.
--
-- **Priced at zero, deliberately.** These rows appear in the Usage breakdown as
-- counts and never as credits, and no cap, gate, meter or balance reads them.
-- What they make possible is seeing that a Flow is firing a thousand outbound
-- requests an hour, which today nothing anywhere would show.

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  operation text not null
    check (operation in ('api_request', 'send_email', 'http_flow_run', 'webhook_call')),
  unit text not null check (unit in ('request', 'invocation', 'email')),
  -- `refused` is us saying no (an egress policy, an unconfigured transport);
  -- `failed` is the other side or the network. A Flow firing a thousand
  -- refusals an hour is a different problem from one firing a thousand
  -- successes, and one status column would have hidden that.
  status text not null check (status in ('succeeded', 'failed', 'refused')),
  quantity integer not null default 1 check (quantity >= 0),
  -- The same attribution the model ledger carries (#848/#849), and no foreign
  -- keys for the same reason: a record of what happened must outlive what it
  -- names.
  member_id uuid,
  teammate_id text,
  api_key_id uuid,
  routine_id text,
  flow_id text,
  assistant_id text,
  conversation_id text,
  surface text
    check (
      surface is null
      or surface in (
        'widget', 'preview', 'teammate', 'channel', 'routine',
        'http_flow', 'api', 'ingestion', 'scheduled'
      )
    )
);

comment on table public.usage_events is
  'Non-model platform operations (#854): outbound API requests, emails, inbound flow runs and webhooks. Counted, never priced; no cap or meter reads this table.';

create index usage_events_org_occurred_idx
  on public.usage_events (organization_id, occurred_at desc);

alter table public.usage_events enable row level security;

-- Members read their own organization's events; only the runtime writes, with
-- the service role, so there are deliberately no write policies.
create policy "members read org usage events" on public.usage_events
  for select using (private.is_org_member(organization_id));

-- One organization's non-model operations over a window, grouped for display.
-- Counts only: there is no rate to apply and, until there is, none should be
-- invented here.
create or replace function public.org_usage_events(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  operation text,
  unit text,
  status text,
  quantity bigint,
  calls bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    operation,
    unit,
    status,
    sum(quantity)::bigint,
    count(*)::bigint
  from public.usage_events
  where organization_id = p_organization_id
    and occurred_at >= p_from
    and occurred_at < p_to
  group by 1, 2, 3;
$$;

comment on function public.org_usage_events(uuid, timestamptz, timestamptz) is
  'Non-model operations for one organization over an arbitrary [from, to) window, grouped by operation, unit and status. Counts only; these are priced at zero.';
