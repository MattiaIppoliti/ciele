-- The usage rollup catches up on the days it missed.
--
-- `rollup_usage_daily(2)` recomputes today and yesterday, and every usage read
-- takes a closed day from `usage_daily` without looking back at the ledger.
-- So a nightly run that failed once (a cron outage, a missing CRON_SECRET, a
-- timeout) left the day before it holding only what the previous run saw, its
-- first two hours, for good. The enterprise plan allowance is enforced from
-- those numbers.
--
-- The fix records the last day a run closed, and the next run recomputes
-- everything after it. A first run has no record, so it reaches back the full
-- cap and repairs whatever gaps already exist.

create table if not exists public.usage_rollup_state (
  id boolean primary key default true check (id),
  -- The last UTC day a completed run recomputed after it had ended.
  closed_through date not null,
  updated_at timestamptz not null default now()
);

-- Service role only: RLS on with no policies, and no grants to API roles.
alter table public.usage_rollup_state enable row level security;
revoke all on table public.usage_rollup_state from anon, authenticated;

create or replace function public.rollup_usage_catch_up(p_max_days integer default 35)
returns integer
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  today date := (now() at time zone 'utc')::date;
  closed date;
  window_days integer;
  upserted integer;
begin
  select closed_through into closed from public.usage_rollup_state where id;
  -- From the day after the last closed one through today, never less than the
  -- two-day window that re-covers late rows for yesterday, never more than
  -- the cap.
  window_days := least(
    greatest(p_max_days, 2),
    greatest(2, today - coalesce(closed, today - greatest(p_max_days, 2)))
  );
  upserted := public.rollup_usage_daily(window_days);
  insert into public.usage_rollup_state (id, closed_through, updated_at)
  values (true, today - 1, now())
  on conflict (id) do update
    set closed_through = greatest(usage_rollup_state.closed_through, excluded.closed_through),
        updated_at = now();
  return upserted;
end
$$;

revoke all on function public.rollup_usage_catch_up(integer) from public, anon, authenticated;
grant execute on function public.rollup_usage_catch_up(integer) to service_role;
