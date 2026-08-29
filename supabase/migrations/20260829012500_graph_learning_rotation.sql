-- Persist a global cursor so the bounded nightly graph pass rotates fairly
-- through active datasets instead of starving collections late in id order.
create table if not exists private.graph_learning_cursor (
  singleton boolean primary key default true check (singleton),
  after_collection_id text
);

insert into private.graph_learning_cursor (singleton)
values (true) on conflict (singleton) do nothing;

create or replace function public.claim_active_graph_datasets(p_limit integer)
returns table (organization_id uuid, collection_id text)
language plpgsql volatile security definer
set search_path = public, private as $$
declare
  v_cursor text;
  v_ids text[];
begin
  if auth.role() <> 'service_role' then
    raise insufficient_privilege using message = 'Graph learning requires service role';
  end if;

  select after_collection_id into v_cursor
  from private.graph_learning_cursor where singleton = true for update;

  select coalesce(array_agg(active.collection_id order by active.position), '{}')
  into v_ids
  from (
    select grouped.collection_id,
      row_number() over (order by
        case when v_cursor is null or grouped.collection_id > v_cursor then 0 else 1 end,
        grouped.collection_id
      ) as position
    from (
      select distinct s.collection_id
      from public.assistant_sources links
      join public.sources s on s.id = links.source_id
      join public.assistants a on a.id = links.assistant_id
      where a.knowledge_engine = 'graph'
    ) grouped
    order by
      case when v_cursor is null or grouped.collection_id > v_cursor then 0 else 1 end,
      grouped.collection_id
    limit greatest(0, least(p_limit, 25))
  ) active;

  update private.graph_learning_cursor
  set after_collection_id = v_ids[array_length(v_ids, 1)]
  where singleton = true and cardinality(v_ids) > 0;

  return query
  select (min(a.organization_id::text))::uuid, s.collection_id
  from public.assistant_sources links
  join public.sources s on s.id = links.source_id
  join public.assistants a on a.id = links.assistant_id
  where a.knowledge_engine = 'graph' and s.collection_id = any(v_ids)
  group by s.collection_id
  order by array_position(v_ids, s.collection_id);
end;
$$;

revoke all on function public.claim_active_graph_datasets(integer)
  from public, anon, authenticated;
grant execute on function public.claim_active_graph_datasets(integer)
  to service_role;
