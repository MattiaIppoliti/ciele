-- Idempotency ledger for one user-message turn. The lease prevents duplicate
-- model execution under retries/concurrency; completion remains replayable.

create table if not exists public.conversation_turns (
  conversation_id text not null references public.conversations(id) on delete cascade,
  request_id text not null,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  lease_token uuid not null default gen_random_uuid(),
  locked_by text not null,
  locked_at timestamptz not null default now(),
  assistant_message_id text,
  error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, request_id)
);

create index if not exists conversation_turns_retention_idx
  on public.conversation_turns (updated_at, conversation_id);

alter table public.conversation_turns enable row level security;

create or replace function private.conversation_organization_id(
  p_conversation_id text
)
returns uuid
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(a.organization_id, t.organization_id)
  from public.conversations c
  left join public.assistants a on a.id = c.assistant_id
  left join public.teammates t on t.id = c.teammate_id
  where c.id = p_conversation_id;
$$;

create policy "conversation owners read turn claims" on public.conversation_turns
  for select using (
    private.is_org_member(private.conversation_organization_id(conversation_id))
  );

create or replace function public.claim_conversation_turn(
  p_conversation_id text,
  p_request_id text,
  p_worker_id text,
  p_now timestamptz,
  p_stale_before timestamptz
)
returns table (
  claim_status text,
  claim_lease_token uuid,
  claim_assistant_message_id text
)
language plpgsql
volatile
security definer
set search_path = public, private
as $$
declare
  v_turn public.conversation_turns%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise insufficient_privilege using message = 'Turn claim requires service role';
  end if;
  insert into public.conversation_turns (
    conversation_id, request_id, status, lease_token,
    locked_by, locked_at, created_at, updated_at
  ) values (
    p_conversation_id, p_request_id, 'running', gen_random_uuid(),
    p_worker_id, p_now, p_now, p_now
  )
  on conflict (conversation_id, request_id) do nothing
  returning * into v_turn;

  if found then
    return query select 'claimed'::text, v_turn.lease_token, null::text;
    return;
  end if;

  select * into v_turn
  from public.conversation_turns ct
  where ct.conversation_id = p_conversation_id
    and ct.request_id = p_request_id
  for update;

  if v_turn.status = 'completed' then
    return query select 'completed'::text, null::uuid, v_turn.assistant_message_id;
    return;
  end if;
  if v_turn.status = 'running' and v_turn.locked_at > p_stale_before then
    return query select 'running'::text, null::uuid, null::text;
    return;
  end if;

  update public.conversation_turns ct
  set status = 'running',
      lease_token = gen_random_uuid(),
      locked_by = p_worker_id,
      locked_at = p_now,
      error = '',
      updated_at = p_now
  where ct.conversation_id = p_conversation_id
    and ct.request_id = p_request_id
  returning ct.* into v_turn;
  return query select 'claimed'::text, v_turn.lease_token, null::text;
end;
$$;

create or replace function public.complete_conversation_turn(
  p_conversation_id text,
  p_request_id text,
  p_lease_token uuid,
  p_assistant_message_id text,
  p_now timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, private
as $$
begin
  if auth.role() <> 'service_role' then
    raise insufficient_privilege using message = 'Turn completion requires service role';
  end if;
  update public.conversation_turns ct
  set status = 'completed',
      assistant_message_id = p_assistant_message_id,
      updated_at = p_now
  where ct.conversation_id = p_conversation_id
    and ct.request_id = p_request_id
    and ct.status = 'running'
    and ct.lease_token = p_lease_token;
  return found;
end;
$$;

create or replace function public.fail_conversation_turn(
  p_conversation_id text,
  p_request_id text,
  p_lease_token uuid,
  p_error text,
  p_now timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, private
as $$
begin
  if auth.role() <> 'service_role' then
    raise insufficient_privilege using message = 'Turn failure requires service role';
  end if;
  update public.conversation_turns ct
  set status = 'failed', error = left(p_error, 2000), updated_at = p_now
  where ct.conversation_id = p_conversation_id
    and ct.request_id = p_request_id
    and ct.status = 'running'
    and ct.lease_token = p_lease_token;
  return found;
end;
$$;

revoke all on function public.claim_conversation_turn(
  text, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
revoke all on function public.complete_conversation_turn(
  text, text, uuid, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.fail_conversation_turn(
  text, text, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_conversation_turn(
  text, text, text, timestamptz, timestamptz
) to service_role;
grant execute on function public.complete_conversation_turn(
  text, text, uuid, text, timestamptz
) to service_role;
grant execute on function public.fail_conversation_turn(
  text, text, uuid, text, timestamptz
) to service_role;
