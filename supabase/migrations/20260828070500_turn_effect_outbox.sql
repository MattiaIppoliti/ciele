-- Deferred Flow effects are committed with the assistant message and delivered
-- from a fenced outbox. A crash can delay an effect, but cannot lose it.

alter table public.messages
  add column if not exists deferred_effects jsonb not null default '[]'::jsonb;

create table if not exists public.turn_effect_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id text not null references public.conversations(id) on delete cascade,
  message_id text not null references public.messages(id) on delete cascade,
  effect_index integer not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed')),
  attempts integer not null default 0,
  next_run_at timestamptz not null default now(),
  lease_token uuid,
  locked_by text,
  locked_at timestamptz,
  error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_id, effect_index)
);

create index if not exists turn_effect_outbox_claim_idx
  on public.turn_effect_outbox (next_run_at, created_at, id)
  where status in ('pending', 'running');
create index if not exists turn_effect_outbox_organization_idx
  on public.turn_effect_outbox (organization_id, created_at, id);
create index if not exists turn_effect_outbox_conversation_idx
  on public.turn_effect_outbox (conversation_id, created_at, id);

alter table public.turn_effect_outbox enable row level security;
create policy "members read turn effects" on public.turn_effect_outbox
  for select using (private.is_org_member(organization_id));

create or replace function private.enqueue_message_effects()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_organization_id uuid;
begin
  if new.role <> 'assistant' or jsonb_array_length(new.deferred_effects) = 0 then
    return new;
  end if;
  v_organization_id := private.conversation_organization_id(new.conversation_id);
  insert into public.turn_effect_outbox (
    organization_id, conversation_id, message_id, effect_index, payload
  )
  select v_organization_id, new.conversation_id, new.id,
         (entry.ordinality - 1)::integer, entry.value
  from jsonb_array_elements(new.deferred_effects)
    with ordinality as entry(value, ordinality)
  on conflict (message_id, effect_index) do nothing;
  return new;
end;
$$;

drop trigger if exists messages_enqueue_deferred_effects on public.messages;
create trigger messages_enqueue_deferred_effects
after insert on public.messages
for each row execute function private.enqueue_message_effects();

drop function if exists public.append_turn_message(
  text, text, text, text, jsonb, text, text, jsonb
);
create function public.append_turn_message(
  p_id text,
  p_conversation_id text,
  p_request_id text,
  p_role text,
  p_content jsonb,
  p_flow_id text,
  p_flow_name text,
  p_trace jsonb,
  p_deferred_effects jsonb
)
returns setof public.messages
language plpgsql
volatile
security invoker
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and (
    p_role <> 'user'
    or jsonb_array_length(coalesce(p_deferred_effects, '[]'::jsonb)) > 0
  ) then
    raise insufficient_privilege using message = 'Only the runtime may append assistant effects';
  end if;
  return query
    insert into public.messages (
      id, conversation_id, request_id, role, content,
      flow_id, flow_name, trace, deferred_effects
    ) values (
      p_id, p_conversation_id, p_request_id, p_role, p_content,
      p_flow_id, p_flow_name, p_trace, coalesce(p_deferred_effects, '[]'::jsonb)
    )
    on conflict (conversation_id, request_id, role)
      where request_id is not null
    do nothing
    returning *;
  if found then return; end if;
  return query
    select m.* from public.messages m
    where m.conversation_id = p_conversation_id
      and m.request_id = p_request_id
      and m.role = p_role;
end;
$$;

create or replace function public.commit_conversation_turn(
  p_message_id text,
  p_conversation_id text,
  p_request_id text,
  p_lease_token uuid,
  p_content jsonb,
  p_flow_id text,
  p_flow_name text,
  p_trace jsonb,
  p_deferred_effects jsonb,
  p_now timestamptz
)
returns setof public.messages
language plpgsql
volatile
security definer
set search_path = public, private
as $$
declare
  v_turn public.conversation_turns%rowtype;
  v_message public.messages%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise insufficient_privilege using message = 'Turn commit requires service role';
  end if;
  select * into v_turn
  from public.conversation_turns ct
  where ct.conversation_id = p_conversation_id
    and ct.request_id = p_request_id
  for update;
  if not found or v_turn.status <> 'running'
     or v_turn.lease_token <> p_lease_token then
    return;
  end if;

  insert into public.messages (
    id, conversation_id, request_id, role, content,
    flow_id, flow_name, trace, deferred_effects
  ) values (
    p_message_id, p_conversation_id, p_request_id, 'assistant', p_content,
    p_flow_id, p_flow_name, p_trace, coalesce(p_deferred_effects, '[]'::jsonb)
  )
  on conflict (conversation_id, request_id, role)
    where request_id is not null
  do nothing
  returning * into v_message;
  if not found then
    select * into v_message from public.messages m
    where m.conversation_id = p_conversation_id
      and m.request_id = p_request_id
      and m.role = 'assistant';
  end if;

  update public.conversation_turns ct
  set status = 'completed', assistant_message_id = v_message.id,
      updated_at = p_now
  where ct.conversation_id = p_conversation_id
    and ct.request_id = p_request_id
    and ct.status = 'running'
    and ct.lease_token = p_lease_token;
  if not found then raise serialization_failure; end if;
  return next v_message;
end;
$$;

create or replace function public.claim_turn_effects(
  p_message_id text,
  p_worker_id text,
  p_now timestamptz,
  p_stale_before timestamptz,
  p_limit integer
)
returns setof public.turn_effect_outbox
language plpgsql
volatile
security definer
set search_path = public, private
as $$
begin
  if auth.role() <> 'service_role' then
    raise insufficient_privilege using message = 'Effect drain requires service role';
  end if;
  return query
  with candidates as (
    select e.id
    from public.turn_effect_outbox e
    where (p_message_id is null or e.message_id = p_message_id)
      and (
        (e.status = 'pending' and e.next_run_at <= p_now)
        or (e.status = 'running' and e.locked_at <= p_stale_before)
      )
    order by e.next_run_at, e.created_at, e.id
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  )
  update public.turn_effect_outbox e
  set status = 'running', attempts = e.attempts + 1,
      lease_token = gen_random_uuid(), locked_by = p_worker_id,
      locked_at = p_now, updated_at = p_now
  from candidates c
  where e.id = c.id
  returning e.*;
end;
$$;

create or replace function public.settle_turn_effect(
  p_id uuid,
  p_lease_token uuid,
  p_now timestamptz,
  p_succeeded boolean,
  p_error text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, private
as $$
begin
  update public.turn_effect_outbox e
  set status = case
        when p_succeeded then 'succeeded'
        when e.attempts >= 5 then 'failed'
        else 'pending'
      end,
      next_run_at = case
        when p_succeeded then e.next_run_at
        else p_now + make_interval(mins => greatest(1, e.attempts))
      end,
      lease_token = null, locked_by = null, locked_at = null,
      error = case when p_succeeded then '' else left(coalesce(p_error, ''), 2000) end,
      updated_at = p_now
  where e.id = p_id
    and e.status = 'running'
    and e.lease_token = p_lease_token
    and auth.role() = 'service_role';
  return found;
end;
$$;

revoke all on function public.append_turn_message(
  text, text, text, text, jsonb, text, text, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.commit_conversation_turn(
  text, text, text, uuid, jsonb, text, text, jsonb, jsonb, timestamptz
) from public, anon, authenticated;
revoke all on function public.claim_turn_effects(
  text, text, timestamptz, timestamptz, integer
) from public, anon;
revoke all on function public.settle_turn_effect(
  uuid, uuid, timestamptz, boolean, text
) from public, anon;
grant execute on function public.append_turn_message(
  text, text, text, text, jsonb, text, text, jsonb, jsonb
) to authenticated, service_role;
grant execute on function public.commit_conversation_turn(
  text, text, text, uuid, jsonb, text, text, jsonb, jsonb, timestamptz
) to service_role;
grant execute on function public.claim_turn_effects(
  text, text, timestamptz, timestamptz, integer
) to service_role;
grant execute on function public.settle_turn_effect(
  uuid, uuid, timestamptz, boolean, text
) to service_role;

drop policy "members write messages" on public.messages;
create policy "members write user messages" on public.messages
  for insert with check (
    role = 'user'
    and jsonb_array_length(deferred_effects) = 0
    and private.is_org_member(private.conversation_organization_id(conversation_id))
  );
