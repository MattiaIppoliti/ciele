-- The five-routines-per-Teammate cap, as a constraint rather than a hope
-- (spec ciele-org#767, ticket ciele-org#772).
--
-- The operations layer counts the rows and then inserts, which is a check with
-- a gap in the middle: two creates that interleave inside that gap both read
-- four and both insert, and the Teammate ends up with six. The friendly
-- refusal stays where it is (a check-constraint violation is not a sentence
-- anybody can act on), and this is the backstop that makes the number true.
--
-- A trigger rather than a check constraint because the rule counts sibling
-- rows, which `check` cannot see. `pg_advisory_xact_lock` on the Teammate
-- serialises concurrent inserts for the same Teammate so the count is taken
-- under a lock: without it two concurrent transactions each see four
-- committed rows and neither sees the other's uncommitted insert.

create or replace function private.enforce_teammate_routine_cap()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  routine_count int;
  -- Mirrors TEAMMATE_ROUTINE_CAP in packages/core/src/routines.ts, which SQL
  -- cannot import. Change both.
  cap constant int := 5;
begin
  -- Serialise per Teammate, not globally: two different Teammates gaining a
  -- routine at the same moment have no reason to wait for each other.
  perform pg_advisory_xact_lock(hashtext(new.teammate_id));

  select count(*) into routine_count
  from public.teammate_routines
  where teammate_id = new.teammate_id;

  if routine_count >= cap then
    raise exception 'A teammate can have % routines.', cap
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_teammate_routine_cap on public.teammate_routines;
create trigger enforce_teammate_routine_cap
  before insert on public.teammate_routines
  for each row
  execute function private.enforce_teammate_routine_cap();

comment on function private.enforce_teammate_routine_cap() is
  'Caps teammate_routines at 5 per teammate (#772). The operations layer checks first for a readable refusal; this closes the count-then-insert race behind it.';

comment on table public.teammate_routines is
  'Recurring unattended Teammate runs (#772). Capped at 5 per Teammate by the trigger above, with a readable refusal in the operations layer in front of it; each run persists a Conversation in the author''s thread and stamps last_run_at as both lease and cadence anchor. Drained hourly by /api/cron/run-routines, which is what makes the preferred hour meaningful.';
