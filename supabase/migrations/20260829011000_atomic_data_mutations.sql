-- Shared JSON metadata is patched in the database so concurrent writers do
-- not overwrite fields they never read or owned.
create or replace function public.merge_conversation_metadata(
  p_id text,
  p_patch jsonb
)
returns boolean
language sql
volatile
security invoker
set search_path = public
as $$
  with updated as (
    update public.conversations
    set metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb)
    where id = p_id
    returning 1
  )
  select exists(select 1 from updated);
$$;

create or replace function public.append_conversation_referral(
  p_id text,
  p_referral jsonb
)
returns boolean
language sql
volatile
security invoker
set search_path = public
as $$
  with updated as (
    update public.conversations
    set metadata = jsonb_set(
      coalesce(metadata, '{}'::jsonb),
      '{referredTo}',
      coalesce(metadata->'referredTo', '[]'::jsonb) || jsonb_build_array(p_referral),
      true
    )
    where id = p_id
    returning 1
  )
  select exists(select 1 from updated);
$$;

-- Desired-set replacements are one transaction. Source links use a diff so
-- direct_access on links that remain selected is preserved.
create or replace function public.set_source_assistant_links(
  p_source_id text,
  p_assistant_ids text[]
)
returns void
language plpgsql
volatile
security invoker
set search_path = public
as $$
begin
  -- Serialize the replacement even when the current link set is empty.
  perform 1 from public.sources where id = p_source_id for update;
  if not found then
    raise foreign_key_violation using message = 'Source not found';
  end if;

  delete from public.assistant_sources
  where source_id = p_source_id
    and not (assistant_id = any(coalesce(p_assistant_ids, array[]::text[])));

  insert into public.assistant_sources (assistant_id, source_id)
  select assistant_id, p_source_id
  from unnest(coalesce(p_assistant_ids, array[]::text[])) as wanted(assistant_id)
  on conflict (assistant_id, source_id) do nothing;
end;
$$;

create or replace function public.set_assistant_skills(
  p_assistant_id text,
  p_skill_ids text[]
)
returns void
language plpgsql
volatile
security invoker
set search_path = public
as $$
begin
  -- Lock the stable parent, not the child rows that may not exist yet.
  perform 1 from public.assistants where id = p_assistant_id for update;
  if not found then
    raise foreign_key_violation using message = 'Assistant not found';
  end if;

  delete from public.assistant_skills where assistant_id = p_assistant_id;
  insert into public.assistant_skills (assistant_id, skill_id, position)
  select p_assistant_id, skill_id, first_ordinality - 1
  from (
    select skill_id, min(ordinality)::integer as first_ordinality
    from unnest(coalesce(p_skill_ids, array[]::text[])) with ordinality
      as wanted(skill_id, ordinality)
    group by skill_id
  ) as deduplicated
  order by first_ordinality;
end;
$$;

-- One fetched Entity snapshot commits behind a version check. The config row
-- is the writer fence: two fetches from the same prior version cannot both
-- replace live records, and records/prune/report/cadence advance together.
create or replace function public.commit_entity_sync(
  p_entity_id text,
  p_expected_last_synced_at timestamptz,
  p_rows jsonb,
  p_prune boolean,
  p_rejected text[],
  p_at timestamptz
)
returns setof public.entity_sync_runs
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_config public.entity_sync_configs%rowtype;
  v_upserted integer := 0;
  v_pruned integer := 0;
  v_run public.entity_sync_runs%rowtype;
begin
  select * into v_config
  from public.entity_sync_configs
  where entity_id = p_entity_id
  for update;
  if not found then
    raise foreign_key_violation using message = 'Entity sync config not found';
  end if;

  if v_config.last_synced_at is distinct from p_expected_last_synced_at then
    insert into public.entity_sync_runs (
      id, entity_id, status, upserted, pruned, rejected, error, finished_at
    ) values (
      gen_random_uuid()::text, p_entity_id, 'failed', 0, 0,
      to_jsonb(coalesce(p_rejected, array[]::text[])),
      'Superseded by a newer sync', p_at
    ) returning * into v_run;
    return next v_run;
    return;
  end if;

  with incoming as (
    select row->>'key' as record_key, coalesce(row->'values', '{}'::jsonb) as values
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as item(row)
  ), changed as (
    insert into public.entity_records (id, entity_id, record_key, values, updated_at)
    select gen_random_uuid()::text, p_entity_id, record_key, values, p_at
    from incoming
    on conflict (entity_id, record_key) do update
      set values = excluded.values, updated_at = excluded.updated_at
      where public.entity_records.values is distinct from excluded.values
    returning 1
  )
  select count(*)::integer into v_upserted from changed;

  if p_prune and jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 0 then
    with removed as (
      delete from public.entity_records existing
      where existing.entity_id = p_entity_id
        and not exists (
          select 1
          from jsonb_array_elements(p_rows) as item(row)
          where row->>'key' = existing.record_key
        )
      returning 1
    )
    select count(*)::integer into v_pruned from removed;
  end if;

  update public.entity_sync_configs
  set last_synced_at = p_at, updated_at = p_at
  where entity_id = p_entity_id;

  insert into public.entity_sync_runs (
    id, entity_id, status, upserted, pruned, rejected, error, finished_at
  ) values (
    gen_random_uuid()::text, p_entity_id, 'succeeded', v_upserted, v_pruned,
    to_jsonb(coalesce(p_rejected, array[]::text[])), null, p_at
  ) returning * into v_run;
  return next v_run;
end;
$$;
