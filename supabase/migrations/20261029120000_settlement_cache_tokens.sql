-- A hard-budget settlement records the prompt-cache tokens of each row it
-- inserts into ai_usage, as the per-turn ledger insert does since
-- 20261028170000_ai_usage_cache_tokens. Both functions are otherwise the bodies
-- of 20260829010000_hard_budget_full_reservation, which nothing has redefined.

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
    provider, model_id, credential_kind, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
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
    coalesce((row->>'outputTokens')::integer, 0),
    coalesce((row->>'cacheReadTokens')::integer, 0),
    coalesce((row->>'cacheWriteTokens')::integer, 0)
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
