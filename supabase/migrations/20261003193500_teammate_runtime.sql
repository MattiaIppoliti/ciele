-- Expand first. Old rows and old schemas keep native execution without new tools.
alter table public.teammates add column if not exists runtime_config jsonb;
alter table public.teammates add constraint teammates_runtime_config_check check (
  runtime_config is null or coalesce((
    jsonb_typeof(runtime_config) = 'object'
    and runtime_config - array['harness','internet','computer'] = '{}'::jsonb
    and jsonb_typeof(runtime_config->'internet') = 'boolean'
    and case runtime_config #>> '{harness,kind}'
      when 'ciele' then runtime_config->'harness' = '{"kind":"ciele"}'::jsonb
      when 'ag_ui' then jsonb_typeof(runtime_config->'harness') = 'object'
        and (runtime_config->'harness') - array['kind','connectionId'] = '{}'::jsonb
        and jsonb_typeof(runtime_config #> '{harness,connectionId}') = 'string'
        and runtime_config #>> '{harness,connectionId}' ~ '^[a-zA-Z0-9_-]{1,80}$'
      else false end
    and jsonb_typeof(runtime_config->'computer') = 'object'
    and (runtime_config->'computer') - array['browser','files','terminal'] = '{}'::jsonb
    and jsonb_typeof(runtime_config #> '{computer,browser}') = 'boolean'
    and jsonb_typeof(runtime_config #> '{computer,files}') = 'boolean'
    and jsonb_typeof(runtime_config #> '{computer,terminal}') = 'boolean'
    and (runtime_config #> '{computer,browser}' = 'false'::jsonb or runtime_config->'internet' = 'true'::jsonb)
    and (runtime_config #> '{computer,terminal}' = 'false'::jsonb or
      (runtime_config #> '{computer,files}' = 'true'::jsonb and runtime_config->'internet' = 'true'::jsonb))
  ), false)
);

-- Existing persona UPDATE rights must not grant a computer or send context to a harness.
create or replace function private.enforce_teammate_execution_config()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (TG_OP = 'INSERT' and new.runtime_config is not null)
     or (TG_OP = 'UPDATE' and new.runtime_config is distinct from old.runtime_config) then
    if current_user in ('anon', 'authenticated')
       and not private.has_org_role(new.organization_id, 3) then
      raise exception 'Only an Organization admin can configure Teammate execution';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_teammate_execution_config() from public;
create trigger enforce_teammate_execution_config
before insert or update on public.teammates
for each row execute function private.enforce_teammate_execution_config();

-- Group threads retain each Teammate/harness namespace independently.
alter table public.teammate_channels add column runtime_state jsonb not null default '{}'::jsonb
  check (jsonb_typeof(runtime_state) = 'object');
create or replace function private.enforce_channel_runtime_state()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon','authenticated') and
     ((TG_OP = 'INSERT' and new.runtime_state <> '{}'::jsonb)
      or (TG_OP = 'UPDATE' and new.runtime_state is distinct from old.runtime_state)) then
    raise exception 'Only the runtime can write Channel harness state';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_channel_runtime_state() from public;
create trigger enforce_channel_runtime_state before insert or update on public.teammate_channels
for each row execute function private.enforce_channel_runtime_state();

create or replace function public.merge_channel_runtime_state(
  p_organization_id uuid, p_channel_id text, p_patch jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(p_patch) is distinct from 'object' or octet_length(p_patch::text) > 1048576 then
    raise exception 'Invalid Channel harness state patch';
  end if;
  update public.teammate_channels set runtime_state = runtime_state || p_patch
    where id = p_channel_id and organization_id = p_organization_id;
  return found;
end;
$$;
revoke all on function public.merge_channel_runtime_state(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.merge_channel_runtime_state(uuid,text,jsonb) to service_role;
