-- Turn concurrency admission: how many model-backed Conversation Turns may run
-- at once against one scope (an Organization, a shared platform provider key).
--
-- A lease is one row per scope it counts against, all sharing one lease_id, so
-- a turn takes every slot it needs or none of them. Rows expire on their own:
-- a function killed mid-turn (a cold stop, a maxDuration timeout) stops
-- counting once its lease passes, without a sweeper.
--
-- Serialised per scope with a transaction-scoped advisory lock rather than a
-- row lock, because there is no parent row to lock: a scope is a string the
-- runtime derives, and the first turn against it must be as safe as the next.
-- Keys are locked in sorted order so two turns asking for the same pair of
-- scopes can never deadlock.

create table if not exists public.turn_concurrency_leases (
  lease_id uuid not null,
  scope_key text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (lease_id, scope_key)
);

create index if not exists turn_concurrency_leases_scope_idx
  on public.turn_concurrency_leases (scope_key, expires_at);

-- Service role only: no policy on purpose, so RLS denies every other role.
alter table public.turn_concurrency_leases enable row level security;

create or replace function public.acquire_turn_concurrency(
  p_scope_keys text[],
  p_limits integer[],
  p_now timestamptz,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, private
as $$
declare
  v_scope record;
  v_active integer;
  v_id uuid := gen_random_uuid();
begin
  if auth.role() <> 'service_role' then
    raise insufficient_privilege using message = 'Turn concurrency requires service role';
  end if;
  if coalesce(array_length(p_scope_keys, 1), 0) = 0
     or array_length(p_scope_keys, 1) <> array_length(p_limits, 1)
     or array_length(p_scope_keys, 1) > 8 then
    raise invalid_parameter_value using message = 'Scope keys and limits must pair up (1 to 8)';
  end if;

  for v_scope in
    select distinct k from unnest(p_scope_keys) as k order by k
  loop
    perform pg_advisory_xact_lock(hashtextextended('turn-concurrency:' || v_scope.k, 0));
  end loop;

  delete from public.turn_concurrency_leases l
  where l.scope_key = any(p_scope_keys) and l.expires_at <= p_now;

  for v_scope in
    select k, l from unnest(p_scope_keys, p_limits) as t(k, l)
  loop
    select count(*) into v_active
    from public.turn_concurrency_leases l
    where l.scope_key = v_scope.k and l.expires_at > p_now;
    if v_active >= greatest(0, v_scope.l) then
      return null;
    end if;
  end loop;

  insert into public.turn_concurrency_leases (lease_id, scope_key, expires_at)
  select v_id, k, p_expires_at
  from (select distinct k from unnest(p_scope_keys) as k) scopes;
  return v_id;
end;
$$;

create or replace function public.release_turn_concurrency(p_lease_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, private
as $$
declare
  v_released integer;
begin
  if auth.role() <> 'service_role' then
    raise insufficient_privilege using message = 'Turn concurrency requires service role';
  end if;
  delete from public.turn_concurrency_leases l where l.lease_id = p_lease_id;
  get diagnostics v_released = row_count;
  return v_released > 0;
end;
$$;

revoke all on function public.acquire_turn_concurrency(text[], integer[], timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function public.release_turn_concurrency(uuid)
  from public, anon, authenticated;
grant execute on function public.acquire_turn_concurrency(text[], integer[], timestamptz, timestamptz)
  to service_role;
grant execute on function public.release_turn_concurrency(uuid)
  to service_role;
