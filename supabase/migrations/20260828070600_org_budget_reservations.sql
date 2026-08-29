-- Hard budgets need admission control, not a read followed by an unrelated
-- model call. Reservations serialize on the org budget row and expire if a
-- worker disappears.

create table if not exists public.org_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reserved_tokens bigint not null default 0,
  reserved_eur numeric(14,6) not null default 0,
  reservation_day date not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.org_budgets
  add column if not exists reserved_tokens bigint not null default 0,
  add column if not exists reserved_eur numeric(14,6) not null default 0,
  add column if not exists spent_tokens bigint not null default 0,
  add column if not exists spent_eur numeric(14,6) not null default 0,
  add column if not exists reservation_day date not null
    default ((now() at time zone 'utc')::date);

create index if not exists org_budget_reservations_active_idx
  on public.org_budget_reservations (organization_id, expires_at);

alter table public.org_budget_reservations enable row level security;

create or replace function public.reserve_org_budget(
  p_organization_id uuid,
  p_max_tokens bigint,
  p_max_eur numeric,
  p_observed_cost_eur numeric,
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
  v_budget public.org_budgets%rowtype;
  v_used_tokens bigint;
  v_reserved_tokens bigint;
  v_reserved_eur numeric;
  v_take_tokens bigint := 0;
  v_take_eur numeric := 0;
  v_id uuid;
  v_expired_tokens bigint := 0;
  v_expired_eur numeric := 0;
begin
  if auth.role() <> 'service_role' then
    raise insufficient_privilege using message = 'Budget reservation requires service role';
  end if;
  select * into v_budget from public.org_budgets
  where organization_id = p_organization_id
  for update;
  if not found or v_budget.enforcement <> 'block' then return null; end if;

  if v_budget.reservation_day <> (p_now at time zone 'utc')::date then
    update public.org_budgets
    set reserved_tokens = 0, reserved_eur = 0,
        spent_tokens = 0, spent_eur = 0,
        reservation_day = (p_now at time zone 'utc')::date
    where organization_id = p_organization_id;
    v_budget.reserved_tokens := 0;
    v_budget.reserved_eur := 0;
    v_budget.spent_tokens := 0;
    v_budget.spent_eur := 0;
  end if;

  with expired as (
    delete from public.org_budget_reservations r
    where r.organization_id = p_organization_id and r.expires_at <= p_now
    returning r.reserved_tokens, r.reserved_eur
  )
  select coalesce(sum(reserved_tokens), 0), coalesce(sum(reserved_eur), 0)
    into v_expired_tokens, v_expired_eur from expired;
  if v_expired_tokens > 0 or v_expired_eur > 0 then
    update public.org_budgets
    set reserved_tokens = greatest(0, reserved_tokens - v_expired_tokens),
        reserved_eur = greatest(0, reserved_eur - v_expired_eur)
    where organization_id = p_organization_id
    returning * into v_budget;
  end if;

  select coalesce(sum(input_tokens + output_tokens), 0)::bigint
    into v_used_tokens
  from public.ai_usage
  where organization_id = p_organization_id
    and created_at >= date_trunc('day', p_now at time zone 'utc') at time zone 'utc'
    and created_at < (date_trunc('day', p_now at time zone 'utc') + interval '1 day') at time zone 'utc';
  v_used_tokens := greatest(v_used_tokens, v_budget.spent_tokens);
  v_reserved_tokens := v_budget.reserved_tokens;
  v_reserved_eur := v_budget.reserved_eur;

  if v_budget.daily_token_limit is not null then
    v_take_tokens := greatest(1, p_max_tokens);
    if v_used_tokens + v_reserved_tokens + v_take_tokens > v_budget.daily_token_limit then
      return null;
    end if;
  end if;
  if v_budget.daily_euro_limit_cents is not null then
    v_take_eur := greatest(0.000001, p_max_eur);
    if greatest(p_observed_cost_eur, v_budget.spent_eur) + v_reserved_eur + v_take_eur
         > v_budget.daily_euro_limit_cents / 100.0 then
      return null;
    end if;
  end if;

  insert into public.org_budget_reservations (
    organization_id, reserved_tokens, reserved_eur, reservation_day, expires_at
  ) values (
    p_organization_id, v_take_tokens, v_take_eur,
    (p_now at time zone 'utc')::date, p_expires_at
  )
  returning id into v_id;
  update public.org_budgets
  set reserved_tokens = reserved_tokens + v_take_tokens,
      reserved_eur = reserved_eur + v_take_eur
  where organization_id = p_organization_id;
  return v_id;
end;
$$;

create or replace function public.release_org_budget_reservation(
  p_id uuid,
  p_actual_tokens bigint,
  p_actual_eur numeric,
  p_now timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, private
as $$
declare
  v_reservation public.org_budget_reservations%rowtype;
begin
  delete from public.org_budget_reservations r
  where r.id = p_id
    and auth.role() = 'service_role'
  returning r.* into v_reservation;
  if not found then return false; end if;
  update public.org_budgets
  set reserved_tokens = greatest(0, reserved_tokens - v_reservation.reserved_tokens),
      reserved_eur = greatest(0, reserved_eur - v_reservation.reserved_eur),
      spent_tokens = spent_tokens + greatest(0, p_actual_tokens),
      spent_eur = spent_eur + greatest(0, p_actual_eur)
  where organization_id = v_reservation.organization_id
    and reservation_day = v_reservation.reservation_day
    and reservation_day = (p_now at time zone 'utc')::date;
  return true;
end;
$$;

revoke all on function public.reserve_org_budget(
  uuid, bigint, numeric, numeric, timestamptz, timestamptz
) from public, anon;
revoke all on function public.release_org_budget_reservation(uuid,bigint,numeric,timestamptz)
  from public, anon, authenticated;
grant execute on function public.reserve_org_budget(
  uuid, bigint, numeric, numeric, timestamptz, timestamptz
) to service_role;
grant execute on function public.release_org_budget_reservation(uuid,bigint,numeric,timestamptz)
  to service_role;
