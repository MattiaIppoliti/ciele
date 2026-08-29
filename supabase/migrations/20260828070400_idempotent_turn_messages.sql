-- One request id may create at most one user and one assistant message in a
-- Conversation. Replays return the original durable message unchanged.

alter table public.messages
  add column if not exists request_id text;

create unique index if not exists messages_turn_role_uidx
  on public.messages (conversation_id, request_id, role)
  where request_id is not null;

create or replace function public.append_turn_message(
  p_id text,
  p_conversation_id text,
  p_request_id text,
  p_role text,
  p_content jsonb,
  p_flow_id text,
  p_flow_name text,
  p_trace jsonb
)
returns setof public.messages
language plpgsql
volatile
security invoker
set search_path = public
as $$
begin
  return query
    insert into public.messages (
      id, conversation_id, request_id, role, content,
      flow_id, flow_name, trace
    ) values (
      p_id, p_conversation_id, p_request_id, p_role, p_content,
      p_flow_id, p_flow_name, p_trace
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

revoke all on function public.append_turn_message(
  text, text, text, text, jsonb, text, text, jsonb
) from public, anon;
grant execute on function public.append_turn_message(
  text, text, text, text, jsonb, text, text, jsonb
) to authenticated, service_role;
