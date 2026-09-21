-- The spender breakdown, made durable (#850, spec #847).
--
-- #848 read the raw ledger over the whole window, which is correct and fine at
-- today's volume but scans more rows every day and keeps nothing once the
-- ledger is trimmed. This adds a per-spender daily rollup beside the existing
-- one and moves the read onto it: whole closed days from the rollup, the
-- partial ends live from the raw ledger, the two ranges disjoint by
-- construction so nothing is counted twice and nothing is missed. That is the
-- construction `org_usage_meters` already uses; the only new thing here is the
-- grain it aggregates to.
--
-- The grain is the whole spender tuple plus provider/model, not one identity
-- per row: a Teammate turn belongs to the Teammate *and* to the Member who
-- asked, so one row legitimately answers two questions, and splitting it into
-- two rows would double the window's total. The pivot onto a single dimension
-- stays in `rankSpenders`.

create table public.usage_spender_daily (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- UTC, like usage_daily: "day" has to mean the same thing in both rollups or
  -- the two pages disagree about which day a call landed on.
  day date not null,
  -- Empty string rather than null on every key column: these are the primary
  -- key, and null would make two rows with the same absent spender distinct.
  member_id text not null default '',
  teammate_id text not null default '',
  api_key_id text not null default '',
  routine_id text not null default '',
  flow_id text not null default '',
  assistant_id text not null default '',
  surface text not null default '',
  credential_kind text not null default 'unknown',
  provider text not null default '',
  model_id text not null default '',
  calls bigint not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (
    organization_id, day, member_id, teammate_id, api_key_id, routine_id,
    flow_id, assistant_id, surface, credential_kind, provider, model_id
  )
);

comment on table public.usage_spender_daily is
  'Per-spender daily usage rollup (#850). Same day grain and same recompute as usage_daily, keyed by the whole spender tuple so the Usage breakdown can pivot onto one dimension at a time without scanning the raw ledger.';

alter table public.usage_spender_daily enable row level security;

-- Members read their own organization's rows; only the scheduled rollup writes,
-- through the service role, so there are deliberately no write policies.
create policy "members read org spender rollup" on public.usage_spender_daily
  for select using (private.is_org_member(organization_id));

-- --------------------------------------------------------------------------
-- The rollup, extended
-- --------------------------------------------------------------------------

-- Same full-day recompute as before, now writing both rollups in one pass.
-- Full-day rather than incremental keeps the cron idempotent and safe to
-- overlap, and safe for rows that land after a day was first rolled up.
create or replace function public.rollup_usage_daily(p_days integer default 2)
returns integer
language sql
volatile
security invoker
set search_path = public
as $$
  with window_start as (
    select (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
      - (greatest(p_days, 1) - 1) * interval '1 day' as from_ts
  ),
  model_rows as (
    insert into public.usage_daily
      (organization_id, day, kind, credential_kind, provider, model_id,
       calls, input_tokens, output_tokens, units, updated_at)
    select
      organization_id,
      (created_at at time zone 'utc')::date,
      case when stage = 'embed' then 'embedding' else 'chat' end,
      coalesce(credential_kind, 'unknown'),
      provider,
      model_id,
      count(*),
      sum(input_tokens),
      sum(output_tokens),
      0,
      now()
    from public.ai_usage
    where created_at >= (select from_ts from window_start)
    group by 1, 2, 3, 4, 5, 6
    on conflict (organization_id, day, kind, credential_kind, provider, model_id)
    do update set
      calls = excluded.calls,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      units = excluded.units,
      updated_at = excluded.updated_at
    returning 1
  ),
  crawl_rows as (
    insert into public.usage_daily
      (organization_id, day, kind, credential_kind, provider, model_id,
       calls, input_tokens, output_tokens, units, updated_at)
    select
      organization_id,
      (created_at at time zone 'utc')::date,
      'crawl',
      'platform',
      coalesce(crawler_provider, 'unknown'),
      '',
      count(*),
      0,
      0,
      sum(page_count),
      now()
    from public.runtime_events
    where kind = 'crawl'
      and status = 'succeeded'
      and coalesce(page_count, 0) > 0
      and created_at >= (select from_ts from window_start)
    group by 1, 2, 5
    on conflict (organization_id, day, kind, credential_kind, provider, model_id)
    do update set
      calls = excluded.calls,
      units = excluded.units,
      updated_at = excluded.updated_at
    returning 1
  ),
  spender_rows as (
    insert into public.usage_spender_daily
      (organization_id, day, member_id, teammate_id, api_key_id, routine_id,
       flow_id, assistant_id, surface, credential_kind, provider, model_id,
       calls, input_tokens, output_tokens, updated_at)
    select
      organization_id,
      (created_at at time zone 'utc')::date,
      -- Absent identities key as '' so the rollup has one "nobody" bucket
      -- rather than a row per null combination.
      coalesce(member_id::text, ''),
      coalesce(teammate_id, ''),
      coalesce(api_key_id::text, ''),
      coalesce(routine_id, ''),
      coalesce(flow_id, ''),
      coalesce(assistant_id, ''),
      coalesce(surface, ''),
      coalesce(credential_kind, 'unknown'),
      provider,
      model_id,
      count(*),
      sum(input_tokens),
      sum(output_tokens),
      now()
    from public.ai_usage
    where created_at >= (select from_ts from window_start)
    group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
    on conflict (organization_id, day, member_id, teammate_id, api_key_id,
                 routine_id, flow_id, assistant_id, surface, credential_kind,
                 provider, model_id)
    do update set
      calls = excluded.calls,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      updated_at = excluded.updated_at
    returning 1
  )
  select (select count(*) from model_rows)::integer
       + (select count(*) from crawl_rows)::integer
       + (select count(*) from spender_rows)::integer;
$$;

revoke execute on function public.rollup_usage_daily(integer) from public, anon, authenticated;
grant execute on function public.rollup_usage_daily(integer) to service_role;

-- --------------------------------------------------------------------------
-- The window read, moved onto the rollup
-- --------------------------------------------------------------------------

-- `create or replace` cannot change a function's OUT parameters, and this one's
-- do change: #848 returned `member_id uuid`, and the rollup keys it as text so
-- an absent spender can be '' rather than null inside a primary key. Postgres
-- answers 42P13 and tells you to drop first, so drop first.
drop function if exists public.org_usage_spenders(uuid, timestamptz, timestamptz);

create function public.org_usage_spenders(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  member_id text,
  teammate_id text,
  api_key_id text,
  routine_id text,
  flow_id text,
  assistant_id text,
  surface text,
  credential_kind text,
  provider text,
  model_id text,
  calls bigint,
  input_tokens bigint,
  output_tokens bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select
      -- First instant of the first UTC day wholly inside the window. Every
      -- truncation is explicitly UTC: truncating in the session TimeZone would
      -- shift this boundary while the rollup's `day` stays a UTC date, and a
      -- shifted boundary makes the two ranges overlap.
      (date_trunc('day', p_from at time zone 'utc') at time zone 'utc')
        + case
            when p_from = (date_trunc('day', p_from at time zone 'utc') at time zone 'utc')
              then interval '0 day'
            else interval '1 day'
          end as first_full_day,
      -- The rollup is only trustworthy for days it has closed: never today.
      least(
        (date_trunc('day', p_to at time zone 'utc') at time zone 'utc'),
        (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
      ) as rollup_end
  ),
  cuts as (
    -- When no whole day fits, both cuts collapse to the window end and the raw
    -- branch covers everything.
    select
      case when rollup_end > first_full_day then first_full_day else p_to end as cut_lo,
      case when rollup_end > first_full_day then rollup_end else p_to end as cut_hi
    from bounds
  )
  select
    member_id, teammate_id, api_key_id, routine_id, flow_id, assistant_id,
    surface, credential_kind, provider, model_id,
    sum(calls)::bigint, sum(input_tokens)::bigint, sum(output_tokens)::bigint
  from public.usage_spender_daily, cuts
  where organization_id = p_organization_id
    and day >= (cuts.cut_lo at time zone 'utc')::date
    and day < (cuts.cut_hi at time zone 'utc')::date
  group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
  union all
  select
    coalesce(member_id::text, ''),
    coalesce(teammate_id, ''),
    coalesce(api_key_id::text, ''),
    coalesce(routine_id, ''),
    coalesce(flow_id, ''),
    coalesce(assistant_id, ''),
    coalesce(surface, ''),
    coalesce(credential_kind, 'unknown'),
    provider,
    model_id,
    count(*)::bigint, sum(input_tokens)::bigint, sum(output_tokens)::bigint
  from public.ai_usage, cuts
  where organization_id = p_organization_id
    and (
      (created_at >= p_from and created_at < least(cuts.cut_lo, p_to))
      or (created_at >= greatest(cuts.cut_hi, p_from) and created_at < p_to)
    )
  group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10;
$$;

comment on function public.org_usage_spenders(uuid, timestamptz, timestamptz) is
  'Usage for one organization over an arbitrary [from, to) window, grouped by the full spender tuple plus provider/model. Whole closed days from usage_spender_daily, partial ends and today live from ai_usage. Absent identities come back as empty strings; the application reads those as "unattributed".';
