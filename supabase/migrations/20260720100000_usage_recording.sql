-- Usage recording (#438, decision #420): the ai_usage ledger is the platform's
-- usage-event table — one row per model call (chat and embedding, both
-- knowledge engines), written at the runtime's single metering seam. This
-- migration completes it for metering:
--   1. records the *connection kind* per call (platform-funded vs BYOK vs
--      federated vs local subscription), so enforcement can treat funded and
--      customer traffic differently;
--   2. widens the stage vocabulary with 'enrich' (OKF enrichment during
--      ingestion) and 'improvement_proposal' (already in the TS type but
--      missing from the check constraint — those inserts were silently
--      rejected because the ledger write path swallows errors by design);
--   3. adds the usage_daily rollup, maintained by the rollup-usage cron, so
--      cap checks and dashboards read a cheap aggregate instead of scanning
--      raw events.

alter table public.ai_usage
  add column credential_kind text
    check (credential_kind in ('platform', 'api_key', 'google_vertex_federated', 'local_subscription'));

comment on column public.ai_usage.credential_kind is
  'Which credential answered the call (platform env key, org BYOK, federated, local subscription). Null on rows recorded before metering landed.';

alter table public.ai_usage drop constraint ai_usage_stage_check;
alter table public.ai_usage add constraint ai_usage_stage_check
  check (stage in ('classify', 'generate', 'embed', 'enrich', 'verify', 'goal_eval', 'compost', 'improvement_proposal'));

-- The rollup scans a cross-org time window; the existing (org, created_at)
-- index cannot serve a bare created_at range.
create index ai_usage_created_idx on public.ai_usage (created_at);

-- Daily rollup: one row per (org, UTC day, chat|embedding, connection kind).
-- Written only by the rollup function (service role via cron); members read.
create table public.usage_daily (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('chat', 'embedding')),
  -- 'unknown' buckets pre-metering ledger rows whose credential_kind is null.
  credential_kind text not null
    check (credential_kind in ('platform', 'api_key', 'google_vertex_federated', 'local_subscription', 'unknown')),
  calls bigint not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, day, kind, credential_kind)
);

alter table public.usage_daily enable row level security;

-- Members read their org's rollup; there is deliberately no insert/update
-- policy — only the service-role cron writes, through rollup_usage_daily().
create policy "members read usage daily" on public.usage_daily
  for select using (private.is_org_member(organization_id));

-- Recomputes the last p_days UTC days (today included) from the raw ledger.
-- Full-day recompute (not incremental) makes the cron idempotent and safe for
-- events that land after a day was first rolled up. Returns rows upserted.
create or replace function public.rollup_usage_daily(p_days integer default 2)
returns integer
language sql
volatile
security invoker
set search_path = public
as $$
  with upserted as (
    insert into public.usage_daily
      (organization_id, day, kind, credential_kind, calls, input_tokens, output_tokens, updated_at)
    select
      organization_id,
      (created_at at time zone 'utc')::date,
      case when stage = 'embed' then 'embedding' else 'chat' end,
      coalesce(credential_kind, 'unknown'),
      count(*),
      sum(input_tokens),
      sum(output_tokens),
      now()
    from public.ai_usage
    where created_at >=
      (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
        - (greatest(p_days, 1) - 1) * interval '1 day'
    group by 1, 2, 3, 4
    on conflict (organization_id, day, kind, credential_kind) do update set
      calls = excluded.calls,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      updated_at = excluded.updated_at
    returning 1
  )
  select coalesce(count(*), 0)::integer from upserted;
$$;

-- The rollup writes cross-org: cron (service role) only.
revoke execute on function public.rollup_usage_daily(integer) from public, anon, authenticated;
grant execute on function public.rollup_usage_daily(integer) to service_role;

-- Org-facing usage read: closed days from the cheap rollup, today live from
-- the raw ledger (the nightly cron hasn't seen today yet). The two ranges are
-- disjoint by construction, so a rollup that already covered part of today
-- never double-counts. Security invoker: RLS scopes members to their org.
create or replace function public.org_usage_daily(p_organization_id uuid, p_days integer default 30)
returns table (
  day date,
  kind text,
  credential_kind text,
  calls bigint,
  input_tokens bigint,
  output_tokens bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select day, kind, credential_kind, calls, input_tokens, output_tokens
  from public.usage_daily
  where organization_id = p_organization_id
    and day < (now() at time zone 'utc')::date
    and day > (now() at time zone 'utc')::date - greatest(p_days, 1)
  union all
  select
    (created_at at time zone 'utc')::date,
    case when stage = 'embed' then 'embedding' else 'chat' end,
    coalesce(credential_kind, 'unknown'),
    count(*),
    sum(input_tokens)::bigint,
    sum(output_tokens)::bigint
  from public.ai_usage
  where organization_id = p_organization_id
    and created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
  group by 1, 2, 3
  order by day desc, kind, credential_kind;
$$;
