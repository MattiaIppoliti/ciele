-- Crawl usage learns who paid for it.
--
-- Until now every crawl was platform-funded: the app's Apify token, the app's
-- Crawl4AI worker, or the free local crawler. The usage readers said so by
-- hardcoding `'platform'` as a crawl row's credential kind. Settings → Crawling
-- (20260922200000_crawler_connections) broke that assumption: an Organization
-- can now run Apify crawls on its own token, and those pages are paid for on
-- its own Apify account. Counting them as platform scraping would bill the
-- Organization's plan allowance for work the platform never paid for.
--
-- The crawl finalizer now stamps `runtime_events.credential_kind = 'api_key'`
-- on an org-funded crawl, the same kind a BYOK model call records, so
-- `fundingBucket` (packages/core/src/funding.ts) and the plan-cap gate
-- (which counts `credential_kind = 'platform'` rows only) read it as customer
-- work with no new kind to classify. Every other crawl, including every event
-- written before this migration (null), stays `'platform'`, exactly as before.
--
-- No backfill is needed: until the connections table existed no crawl could
-- have been org-funded, so the rollup rows already written are all correct.
--
-- The three readers below are the three places that hardcoded the kind. Each
-- is redefined with the same signature and body, only the crawl branch's
-- credential kind (and its GROUP BY) changes, so grants and comments carry over.

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
      case when credential_kind = 'api_key' then 'api_key' else 'platform' end,
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
    group by 1, 2, 4, 5
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

create or replace function public.org_usage_daily(p_organization_id uuid, p_days integer default 30)
returns table (
  day date,
  kind text,
  credential_kind text,
  provider text,
  model_id text,
  calls bigint,
  input_tokens bigint,
  output_tokens bigint,
  units bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select day, kind, credential_kind, provider, model_id,
         calls, input_tokens, output_tokens, units
  from public.usage_daily
  where organization_id = p_organization_id
    and day < (now() at time zone 'utc')::date
    and day > (now() at time zone 'utc')::date - greatest(p_days, 1)
  union all
  select
    (created_at at time zone 'utc')::date,
    case when stage = 'embed' then 'embedding' else 'chat' end,
    coalesce(credential_kind, 'unknown'),
    provider,
    model_id,
    count(*),
    sum(input_tokens)::bigint,
    sum(output_tokens)::bigint,
    0::bigint
  from public.ai_usage
  where organization_id = p_organization_id
    and created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
  group by 1, 2, 3, 4, 5
  union all
  select
    (created_at at time zone 'utc')::date,
    'crawl',
    case when credential_kind = 'api_key' then 'api_key' else 'platform' end,
    coalesce(crawler_provider, 'unknown'),
    '',
    count(*),
    0::bigint,
    0::bigint,
    sum(page_count)::bigint
  from public.runtime_events
  where organization_id = p_organization_id
    and kind = 'crawl'
    and status = 'succeeded'
    and coalesce(page_count, 0) > 0
    and created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
  group by 1, 3, 4
  order by day desc, kind, credential_kind, provider, model_id;
$$;

create or replace function public.org_usage_meters(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  resource text,
  credential_kind text,
  provider text,
  model_id text,
  calls bigint,
  input_tokens bigint,
  output_tokens bigint,
  units bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select
      -- First instant of the first UTC day wholly inside the window. Every
      -- truncation here is explicitly UTC: `date_trunc('day', <timestamptz>)`
      -- would truncate in the session TimeZone, shifting this boundary by the
      -- zone's offset while usage_daily.day stays a UTC date, and a shifted
      -- boundary makes the rollup and live ranges overlap, double-counting the
      -- hours between the two frames.
      case
        when p_from = (date_trunc('day', p_from at time zone 'utc') at time zone 'utc')
          then (date_trunc('day', p_from at time zone 'utc') at time zone 'utc')
        else (date_trunc('day', p_from at time zone 'utc') at time zone 'utc')
          + interval '1 day'
      end as first_full_day,
      -- The rollup is only trustworthy for days it has closed: never today.
      least(
        (date_trunc('day', p_to at time zone 'utc') at time zone 'utc'),
        (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
      ) as rollup_end
  ),
  cuts as (
    -- When no whole day fits (a short window, or one entirely inside today),
    -- both cuts collapse to the window end and the raw branch covers it all.
    select
      case when rollup_end > first_full_day then first_full_day else p_to end as cut_lo,
      case when rollup_end > first_full_day then rollup_end else p_to end as cut_hi
    from bounds
  )
  -- Whole closed days, from the rollup.
  select
    case kind when 'chat' then 'ai' when 'embedding' then 'embedding' else 'scraping' end,
    credential_kind, provider, model_id,
    sum(calls)::bigint, sum(input_tokens)::bigint, sum(output_tokens)::bigint,
    sum(units)::bigint
  from public.usage_daily, cuts
  where organization_id = p_organization_id
    and day >= (cuts.cut_lo at time zone 'utc')::date
    and day < (cuts.cut_hi at time zone 'utc')::date
  group by 1, 2, 3, 4
  union all
  -- Partial head and tail, live from the model ledger.
  select
    case when stage = 'embed' then 'embedding' else 'ai' end,
    coalesce(credential_kind, 'unknown'), provider, model_id,
    count(*)::bigint, sum(input_tokens)::bigint, sum(output_tokens)::bigint, 0::bigint
  from public.ai_usage, cuts
  where organization_id = p_organization_id
    and (
      (created_at >= p_from and created_at < least(cuts.cut_lo, p_to))
      or (created_at >= greatest(cuts.cut_hi, p_from) and created_at < p_to)
    )
  group by 1, 2, 3, 4
  union all
  -- Partial head and tail, live from crawl telemetry.
  select
    'scraping',
    case when credential_kind = 'api_key' then 'api_key' else 'platform' end,
    coalesce(crawler_provider, 'unknown'),
    '',
    count(*)::bigint, 0::bigint, 0::bigint, sum(page_count)::bigint
  from public.runtime_events, cuts
  where organization_id = p_organization_id
    and kind = 'crawl'
    and status = 'succeeded'
    and coalesce(page_count, 0) > 0
    and (
      (created_at >= p_from and created_at < least(cuts.cut_lo, p_to))
      or (created_at >= greatest(cuts.cut_hi, p_from) and created_at < p_to)
    )
  group by 1, 2, 3, 4;
$$;
