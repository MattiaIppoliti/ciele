-- Entity Record query function (spec ciele-org#660, ticket ciele-org#665).
--
-- The read path of the auto-generated Entity retrieval tools: equality
-- filters via jsonb containment plus an optional case-insensitive keyword
-- search over the Record's values. SECURITY INVOKER (the default), so the
-- entity_records RLS from 20260807130000 applies to member clients; widget
-- traffic runs on the service role like the rest of the published surface.

create or replace function public.query_entity_records(
  p_entity_id text,
  p_filters jsonb default '{}'::jsonb,
  p_search text default null,
  p_limit int default 20
)
returns setof public.entity_records
language sql stable as $$
  select r.*
  from public.entity_records r
  join public.entities e on e.id = r.entity_id
  where r.entity_id = p_entity_id
    and r."values" @> p_filters
    and (
      p_search is null
      or exists (
        select 1
        from jsonb_each_text(r."values") kv
        where exists (
          select 1
          from jsonb_array_elements(e.attributes) attribute
          where attribute ->> 'key' = kv.key
            and attribute ->> 'type' = 'text'
        )
        and kv.value ilike
          '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      )
    )
  order by r.record_key
  limit p_limit
$$;

alter function public.query_entity_records(text, jsonb, text, int) set search_path = public;
