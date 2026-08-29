-- Atomic due-goal claiming for the scheduled goal runner. Claiming stamps
-- last_run_at, which doubles as the lease: concurrent ticks skip locked rows
-- and a crashed run simply retries on the next cadence window.

create or replace function public.claim_due_assistant_goals(
  p_due_before timestamptz,
  p_limit integer
)
returns setof public.assistant_goals
language sql
volatile
set search_path = public
as $$
  update public.assistant_goals g
  set last_run_at = now()
  where g.id in (
    select id from public.assistant_goals
    where status = 'active'
      and (last_run_at is null or last_run_at < p_due_before)
    order by last_run_at asc nulls first
    limit p_limit
    for update skip locked
  )
  returning g.*;
$$;
