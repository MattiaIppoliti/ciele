-- The Library reads one bounded page, rather than downloading every Source
-- and issuing a Concept count request for each displayed row. A zero-sized
-- page returns only the tab's totals; it never reads Concept bodies or links.
-- Invoker privileges preserve the Member's RLS on every relation below.
create or replace function public.get_org_knowledge_source_page(
  p_organization_id uuid,
  p_kinds text[],
  p_status text,
  p_assistant_id text,
  p_query text,
  p_page bigint,
  p_page_size bigint
) returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  with matching as materialized (
    select s.id, s.status, s.created_at
    from public.sources s
    join public.knowledge_collections k on k.id = s.collection_id
    where k.organization_id = p_organization_id
      and s.kind = any(p_kinds)
      and (p_status is null or s.status = p_status)
      -- Literal substring semantics, including %, _ and backslashes.
      and strpos(lower(s.name), lower(coalesce(p_query, ''))) > 0
      and (p_assistant_id is null or exists (
        select 1 from public.assistant_sources a
        where a.source_id = s.id and a.assistant_id = p_assistant_id
      ))
  ), page_ids as materialized (
    select id from matching
    order by created_at desc, id desc
    limit greatest(p_page_size, 0)
    offset (greatest(p_page, 1) - 1) * greatest(p_page_size, 0)
  ), page_sources as materialized (
    select s.* from public.sources s join page_ids p on p.id = s.id
  ), concept_counts as (
    select c.source_id, count(*) as total
    from public.concepts c join page_ids p on p.id = c.source_id
    where c.is_active = true
    group by c.source_id
  ), faq_previews as (
    select distinct on (c.source_id) c.source_id, left(c.body, 200) as preview
    from public.concepts c join page_sources s on s.id = c.source_id
    where s.kind = 'faq' and c.is_active = true
    order by c.source_id, c.created_at, c.id
  ), source_links as (
    select l.source_id, jsonb_agg(jsonb_build_object(
      'assistantId', l.assistant_id,
      'assistantName', a.title,
      'directAccess', l.direct_access
    ) order by l.created_at, l.assistant_id) as links
    from public.assistant_sources l
    join page_ids p on p.id = l.source_id
    join public.assistants a on a.id = l.assistant_id
    group by l.source_id
  )
  select jsonb_build_object(
    'total', (select count(*) from matching),
    'statusCounts', (
      select jsonb_build_object(
        'processing', count(*) filter (where status = 'processing'),
        'ready', count(*) filter (where status = 'ready'),
        'error', count(*) filter (where status = 'error')
      ) from matching
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'collectionId', s.collection_id,
        'name', s.name,
        'kind', s.kind,
        'status', s.status,
        'error', coalesce(s.error, ''),
        'config', coalesce(s.config, '{}'::jsonb),
        'lastCrawledAt', s.last_crawled_at,
        'originalObjectPath', s.original_object_path,
        'createdAt', s.created_at,
        'updatedAt', coalesce(s.updated_at, s.created_at),
        'conceptCount', coalesce(c.total, 0),
        'answerPreview', coalesce(f.preview, ''),
        'linkedAssistants', coalesce(l.links, '[]'::jsonb)
      ) order by s.created_at desc, s.id desc)
      from page_sources s
      left join concept_counts c on c.source_id = s.id
      left join faq_previews f on f.source_id = s.id
      left join source_links l on l.source_id = s.id
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.get_org_knowledge_source_page(uuid, text[], text, text, text, bigint, bigint) from public, anon;
grant execute on function public.get_org_knowledge_source_page(uuid, text[], text, text, text, bigint, bigint) to authenticated, service_role;
