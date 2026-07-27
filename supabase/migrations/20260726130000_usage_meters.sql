-- Usage meters (#506): make the usage rollup cover every kind of work the
-- platform pays for, at a grain that can be priced, over an arbitrary window.
--
-- Three changes, one purpose. (1) usage_daily gains the resolved provider and
-- model in its key: credits are estimated COST (packages/db/src/pricing.ts), and
-- cost cannot be recovered from a model-blind aggregate — the same token count
-- is worth 35x more on a frontier model than on the platform default. (2) It
-- gains a 'crawl' kind and a `units` column, so crawled pages are metered
-- alongside model calls instead of being invisible; the crawl finalizer already
-- records one telemetry event per terminal crawl with its resolved crawler and
-- usable page count, so this needs no new write path anywhere. (3) A new
-- window read, org_usage_meters, sums any [from, to) range per resource.
--
-- The window read matters because plan windows are not UTC days: weekly slices
-- run from a Stripe billing anchor, which can fall at any time of day. Reading a
-- day-grained rollup for such a window would silently over- or under-count the
-- partial days at each end, so the function takes whole closed days from the
-- rollup and the partial head/tail live from the raw sources — the same
-- disjoint-ranges construction org_usage_daily already uses for "today", just
-- generalized to both ends.

-- --------------------------------------------------------------------------
-- 1. The rollup's grain
-- --------------------------------------------------------------------------

alter table public.usage_daily
  -- Empty string, not null: these are part of the primary key, and a crawl row
  -- has no model. '' reads as "not applicable" and keys cleanly.
  add column provider text not null default '',
  add column model_id text not null default '',
  -- Metered work that is not tokens: crawled pages. Zero for model calls.
  add column units bigint not null default 0 check (units >= 0);

alter table public.usage_daily drop constraint if exists usage_daily_kind_check;
alter table public.usage_daily add constraint usage_daily_kind_check
  check (kind in ('chat', 'embedding', 'crawl'));

alter table public.usage_daily drop constraint if exists usage_daily_pkey;
alter table public.usage_daily
  add primary key (organization_id, day, kind, credential_kind, provider, model_id);

comment on column public.usage_daily.provider is
  'The provider that actually ran: an LLM provider for chat/embedding rows, the resolved crawler for crawl rows. Part of the key because credits are priced per provider/model.';
comment on column public.usage_daily.units is
  'Non-token metered units — crawled pages on a crawl row, zero elsewhere.';

-- --------------------------------------------------------------------------
-- 2. The rollup, over both sources
-- --------------------------------------------------------------------------

-- Recomputes the last p_days UTC days (today included) from the raw sources.
-- Full-day recompute (not incremental) keeps the cron idempotent and safe for
-- events that land after a day was first rolled up.
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
      -- Every crawler credential is a platform one (the app's Apify token, the
      -- app's Crawl4AI worker, or no credential at all for the local crawler),
      -- so crawled pages are always platform-funded. Revisit if an org ever
      -- brings its own crawler token.
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
      -- A failed or empty crawl cost the platform something in wall-clock but
      -- produced no metered unit, and the page count is what the customer's
      -- allowance is denominated in.
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
  )
  select (select count(*) from model_rows)::integer
       + (select count(*) from crawl_rows)::integer;
$$;

revoke execute on function public.rollup_usage_daily(integer) from public, anon, authenticated;
grant execute on function public.rollup_usage_daily(integer) to service_role;

-- --------------------------------------------------------------------------
-- 3. Org-facing reads
-- --------------------------------------------------------------------------

-- Return type changes (provider / model_id / units), so replace rather than
-- redefine. Consumers select named columns, so the added ones are additive.
drop function if exists public.org_usage_daily(uuid, integer);

create function public.org_usage_daily(p_organization_id uuid, p_days integer default 30)
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
    'platform',
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
  group by 1, 4
  order by day desc, kind, credential_kind, provider, model_id;
$$;

-- Usage over an ARBITRARY window, grouped so the application can price it in
-- credits. Whole closed days come from the rollup; the partial day at each end
-- of the window, and today, come live from the raw sources. The three ranges are
-- disjoint by construction, so nothing is counted twice and nothing is missed.
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
      -- zone's offset while usage_daily.day stays a UTC date — and a shifted
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
    'platform',
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

comment on function public.org_usage_meters(uuid, timestamptz, timestamptz) is
  'Usage for one organization over an arbitrary [from, to) window, grouped by resource/credential/provider/model so the app can price it in credits. Whole closed days from the usage_daily rollup, partial ends and today live from ai_usage + crawl telemetry.';

-- --------------------------------------------------------------------------
-- 4. Rebuild the aggregate at its new grain
-- --------------------------------------------------------------------------

-- usage_daily is a derived aggregate and nothing prunes the raw sources, so the
-- honest way to give existing rows the new key is to recompute them. Leaving
-- them with an empty provider would have priced every historical row at the
-- unknown-model fallback rate — visibly wrong credits for up to 30 days.
delete from public.usage_daily;

-- Recompute every day from the raw sources by calling the rollup itself, rather
-- than repeating its body here: one definition of how a day is aggregated, so
-- the backfill and the nightly cron can never drift apart.
select public.rollup_usage_daily(36500);
