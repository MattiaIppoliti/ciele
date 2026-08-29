-- A hard budget admits a turn only when its complete worst-case reservation
-- fits. A partial reservation is not useful unless the model is also clamped
-- to that partial grant, which the runtime deliberately does not do.

-- Euro admission needs the same serialized source of truth as token
-- admission. `spent_eur` is deliberately conservative: a successful turn
-- consumes its full worst-case reservation. A later caller observation can
-- only move it upward, never rewind spend seen by a concurrent waiter.
alter table public.org_budgets
  add column if not exists spent_eur numeric(14,6) not null default 0;

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
  if auth.role() <> 'service_role' and not private.is_org_member(p_organization_id) then
    raise insufficient_privilege using message = 'Organization not accessible';
  end if;
  select * into v_budget from public.org_budgets
  where organization_id = p_organization_id
  for update;
  if not found or v_budget.enforcement <> 'block' then return null; end if;

  if v_budget.reservation_day <> (p_now at time zone 'utc')::date then
    update public.org_budgets
    set reserved_tokens = 0, reserved_eur = 0,
        spent_eur = greatest(0, p_observed_cost_eur),
        reservation_day = (p_now at time zone 'utc')::date
    where organization_id = p_organization_id
    returning * into v_budget;
    v_budget.reserved_tokens := 0;
    v_budget.reserved_eur := 0;
  else
    update public.org_budgets
    set spent_eur = greatest(spent_eur, greatest(0, p_observed_cost_eur))
    where organization_id = p_organization_id
    returning * into v_budget;
  end if;

  with expired as (
    delete from public.org_budget_reservations r
    where r.organization_id = p_organization_id and r.expires_at <= p_now
    returning r.reserved_tokens, r.reserved_eur, r.reservation_day
  )
  select
    coalesce(sum(reserved_tokens) filter (
      where reservation_day = (p_now at time zone 'utc')::date
    ), 0),
    coalesce(sum(reserved_eur) filter (
      where reservation_day = (p_now at time zone 'utc')::date
    ), 0)
    into v_expired_tokens, v_expired_eur
  from expired;
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
    if v_budget.spent_eur + v_reserved_eur + v_take_eur > v_budget.daily_euro_limit_cents / 100.0 then
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

-- Usage is the durable settlement record for a reservation. Keeping the
-- insert and release in one transaction means a ledger failure leaves the
-- reservation in place (fail closed) instead of making the spend disappear.
create or replace function public.settle_org_budget_reservation(
  p_id uuid,
  p_rows jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, private
as $$
declare
  v_reservation public.org_budget_reservations%rowtype;
  v_settlement_day date := (now() at time zone 'utc')::date;
begin
  delete from public.org_budget_reservations r
  where r.id = p_id
    and (
      auth.role() = 'service_role'
      or private.is_org_member(r.organization_id)
    )
  returning r.* into v_reservation;
  if not found then return false; end if;

  insert into public.ai_usage (
    organization_id, assistant_id, conversation_id, message_id, stage,
    provider, model_id, credential_kind, input_tokens, output_tokens
  )
  select
    v_reservation.organization_id,
    nullif(row->>'assistantId', ''),
    nullif(row->>'conversationId', ''),
    nullif(row->>'messageId', ''),
    row->>'stage',
    row->>'provider',
    row->>'modelId',
    nullif(row->>'credentialKind', ''),
    coalesce((row->>'inputTokens')::integer, 0),
    coalesce((row->>'outputTokens')::integer, 0)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as item(row);

  update public.org_budgets
  set spent_eur = case
        when reservation_day = v_settlement_day then spent_eur
        else 0
      end + v_reservation.reserved_eur,
      reservation_day = v_settlement_day,
      reserved_tokens = case
        when reservation_day = v_settlement_day
          and reservation_day = v_reservation.reservation_day
          then greatest(0, reserved_tokens - v_reservation.reserved_tokens)
        when reservation_day = v_settlement_day then reserved_tokens
        else 0
      end,
      reserved_eur = case
        when reservation_day = v_settlement_day
          and reservation_day = v_reservation.reservation_day
          then greatest(0, reserved_eur - v_reservation.reserved_eur)
        when reservation_day = v_settlement_day then reserved_eur
        else 0
      end
  where organization_id = v_reservation.organization_id;
  return true;
end;
$$;

revoke all on function public.settle_org_budget_reservation(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.settle_org_budget_reservation(uuid, jsonb)
  to service_role;

-- Keep the four-argument overload for one deploy window. Old app instances
-- still call it while the new app uses the one-argument release below.
create or replace function public.release_org_budget_reservation(p_id uuid)
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
    and (
      auth.role() = 'service_role'
      or private.is_org_member(r.organization_id)
    )
  returning r.* into v_reservation;
  if not found then return false; end if;

  update public.org_budgets
  set reserved_tokens = case
        when reservation_day = v_reservation.reservation_day
          then greatest(0, reserved_tokens - v_reservation.reserved_tokens)
        else reserved_tokens
      end,
      reserved_eur = case
        when reservation_day = v_reservation.reservation_day
          then greatest(0, reserved_eur - v_reservation.reserved_eur)
        else reserved_eur
      end
  where organization_id = v_reservation.organization_id;
  return true;
end;
$$;

revoke all on function public.release_org_budget_reservation(uuid)
  from public, anon, authenticated;
grant execute on function public.release_org_budget_reservation(uuid)
  to service_role;
