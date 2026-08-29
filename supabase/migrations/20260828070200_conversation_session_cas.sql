-- Session state is shared by concurrent turns and proactive deliveries. A
-- version fence prevents stale read-modify-write cycles from erasing another
-- turn's memory or delivery ledger.

alter table public.conversations
  add column if not exists session_version bigint not null default 0;

create or replace function private.merge_conversation_session_patch(
  p_state jsonb,
  p_patch jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = public, private
as $$
declare
  v_result jsonb := coalesce(p_state, '{}'::jsonb);
  v_key text;
  v_value jsonb;
begin
  for v_key, v_value in select key, value from jsonb_each(coalesce(p_patch, '{}'::jsonb))
  loop
    if v_key = 'memory'
       and jsonb_typeof(v_value) = 'array' then
      v_result := jsonb_set(
        v_result,
        array[v_key],
        coalesce((
          select jsonb_agg(value order by ordinal)
          from (
            select value, ordinal
            from (
              select distinct on (value) value, ordinal
              from jsonb_array_elements(
                coalesce(v_result -> v_key, '[]'::jsonb) || v_value
              ) with ordinality as entries(value, ordinal)
              order by value, ordinal desc
            ) unique_values
            order by ordinal desc
            limit 20
          ) newest_values
        ), '[]'::jsonb),
        true
      );
    elsif jsonb_typeof(v_value) = 'object'
       and jsonb_typeof(v_result -> v_key) = 'object' then
      v_result := jsonb_set(
        v_result,
        array[v_key],
        (v_result -> v_key) || v_value,
        true
      );
    else
      v_result := jsonb_set(v_result, array[v_key], v_value, true);
    end if;
  end loop;
  return v_result;
end;
$$;

create or replace function public.merge_conversation_session_state(
  p_id text,
  p_expected_version bigint,
  p_patch jsonb
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = public, private
as $$
begin
  update public.conversations
  set session_state = private.merge_conversation_session_patch(session_state, p_patch),
      session_version = session_version + 1,
      updated_at = now()
  where id = p_id
    and session_version = p_expected_version;
  return found;
end;
$$;

revoke all on function public.merge_conversation_session_state(
  text, bigint, jsonb
) from public, anon;
grant execute on function public.merge_conversation_session_state(
  text, bigint, jsonb
) to authenticated, service_role;
