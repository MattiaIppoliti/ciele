-- Multi-instance Idempotency-Key ledger for API v1 mutations. A lease fences
-- concurrent requests; completed responses survive process restarts for 24h.
create table if not exists public.api_idempotency_keys (
  scope text not null,
  idempotency_key text not null,
  request_hash text not null,
  status text not null check (status in ('running', 'completed')),
  lease_token uuid,
  response_status integer,
  response_body text,
  content_type text,
  locked_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (scope, idempotency_key)
);

create index if not exists api_idempotency_expiry_idx
  on public.api_idempotency_keys (expires_at);

alter table public.api_idempotency_keys enable row level security;

create or replace function public.claim_api_idempotency(
  p_scope text,
  p_key text,
  p_request_hash text,
  p_now timestamptz,
  p_expires_at timestamptz
)
returns table (
  claim_status text,
  claim_lease_token uuid,
  claim_response_status integer,
  claim_response_body text,
  claim_content_type text
)
language plpgsql volatile security definer set search_path = public
as $$
declare v_row public.api_idempotency_keys%rowtype;
begin
  -- A completed replay may expire. A running row is an indeterminate
  -- mutation and must remain fenced forever: deleting it would permit the
  -- same key to execute again after a crash between mutation and completion.
  delete from public.api_idempotency_keys
  where status = 'completed' and expires_at <= p_now;
  select * into v_row from public.api_idempotency_keys
  where scope = p_scope and idempotency_key = p_key for update;

  if found then
    if v_row.request_hash <> p_request_hash then
      return query select 'conflict', null::uuid, null::integer, null::text, null::text;
      return;
    end if;
    if v_row.status = 'completed' then
      return query select 'completed', null::uuid, v_row.response_status,
        v_row.response_body, v_row.content_type;
      return;
    end if;
    -- A crashed owner leaves an indeterminate mutation. Never reclaim it:
    -- retrying could apply a mutation that committed just before the crash.
    return query select 'running', null::uuid, null::integer, null::text, null::text;
    return;
  else
    insert into public.api_idempotency_keys (
      scope, idempotency_key, request_hash, status, lease_token,
      locked_at, expires_at, created_at, updated_at
    ) values (
      p_scope, p_key, p_request_hash, 'running', gen_random_uuid(),
      p_now, p_expires_at, p_now, p_now
    ) returning * into v_row;
  end if;
  return query select 'claimed', v_row.lease_token, null::integer, null::text, null::text;
end;
$$;

create or replace function public.complete_api_idempotency(
  p_scope text,
  p_key text,
  p_lease_token uuid,
  p_response_status integer,
  p_response_body text,
  p_content_type text,
  p_now timestamptz
)
returns boolean language plpgsql volatile security definer set search_path = public
as $$
begin
  update public.api_idempotency_keys
  set status = 'completed', lease_token = null,
      response_status = p_response_status, response_body = p_response_body,
      content_type = p_content_type, updated_at = p_now
  where scope = p_scope and idempotency_key = p_key
    and status = 'running' and lease_token = p_lease_token;
  return found;
end;
$$;

create or replace function public.release_api_idempotency(
  p_scope text, p_key text, p_lease_token uuid
)
returns boolean language plpgsql volatile security definer set search_path = public
as $$
begin
  delete from public.api_idempotency_keys
  where scope = p_scope and idempotency_key = p_key
    and status = 'running' and lease_token = p_lease_token;
  return found;
end;
$$;

revoke all on table public.api_idempotency_keys from public, anon, authenticated;
revoke all on function public.claim_api_idempotency(text,text,text,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.complete_api_idempotency(text,text,uuid,integer,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.release_api_idempotency(text,text,uuid) from public, anon, authenticated;
grant execute on function public.claim_api_idempotency(text,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.complete_api_idempotency(text,text,uuid,integer,text,text,timestamptz) to service_role;
grant execute on function public.release_api_idempotency(text,text,uuid) to service_role;
