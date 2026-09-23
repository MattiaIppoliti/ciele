-- Sorting for the Library's table, now that its column headers are clickable.
--
-- The order has to be chosen inside `page_ids`, where the page is cut: sorting
-- the fifty rows the old ordering already picked is not sorting, it is
-- shuffling one page. `matching` therefore computes the sort keys and
-- `page_ids` numbers the rows it keeps, so the final `jsonb_agg` can hand the
-- page back in exactly that order instead of re-deriving it.
--
-- `p_sort` is a name from the client, so unknown values fall through every
-- branch and land on the default, newest first, which is the order every
-- caller had before this.
create or replace function public.get_org_knowledge_source_page(
  p_organization_id uuid,
  p_kinds text[],
  p_status text,
  p_assistant_id text,
  p_query text,
  p_page bigint,
  p_page_size bigint,
  p_sort text,
  p_ascending boolean
) returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  with matching as materialized (
    select
      s.id,
      s.status,
      s.created_at,
      coalesce(s.updated_at, s.created_at) as updated_at,
      lower(s.name) as sort_name
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
    select id, row_number() over () as position
    from (
      select id from matching
      order by
        case when p_sort = 'name' and coalesce(p_ascending, false)
          then sort_name end asc nulls last,
        case when p_sort = 'name' and not coalesce(p_ascending, false)
          then sort_name end desc nulls last,
        case when p_sort = 'status' and coalesce(p_ascending, false)
          then status end asc nulls last,
        case when p_sort = 'status' and not coalesce(p_ascending, false)
          then status end desc nulls last,
        case when p_sort = 'updatedAt' and coalesce(p_ascending, false)
          then updated_at end asc nulls last,
        case when p_sort = 'updatedAt' and not coalesce(p_ascending, false)
          then updated_at end desc nulls last,
        -- createdAt is both the default sort and the tie-break under every
        -- other one, so it needs no branch of its own. Two rows written in
        -- the same millisecond must not swap between pages, or one of them is
        -- never shown; and the tie-break follows `p_ascending` rather than
        -- being fixed descending, because `compareOrgKnowledgeSources` (the
        -- mock Db and the schema-lag fallback) orders ties that way and two
        -- adapters that disagree about ties are two different tables.
        case when coalesce(p_ascending, false) then created_at end asc,
        case when not coalesce(p_ascending, false) then created_at end desc,
        case when coalesce(p_ascending, false) then id end asc,
        id desc
      limit greatest(p_page_size, 0)
      offset (greatest(p_page, 1) - 1) * greatest(p_page_size, 0)
    ) ordered
  ), page_sources as materialized (
    select s.*, p.position from public.sources s join page_ids p on p.id = s.id
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
      ) order by s.position)
      from page_sources s
      left join concept_counts c on c.source_id = s.id
      left join faq_previews f on f.source_id = s.id
      left join source_links l on l.source_id = s.id
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.get_org_knowledge_source_page(uuid, text[], text, text, text, bigint, bigint, text, boolean) from public, anon;
grant execute on function public.get_org_knowledge_source_page(uuid, text[], text, text, text, bigint, bigint, text, boolean) to authenticated, service_role;

-- The seven-argument signature stays, delegating, because a Vercel deploy is
-- live minutes before the CI migrate job (supabase/CLAUDE.md) and a rollback
-- puts the previous app back in front of this schema. It costs one call.
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
  select public.get_org_knowledge_source_page(
    p_organization_id, p_kinds, p_status, p_assistant_id, p_query,
    p_page, p_page_size, null, false
  );
$$;

-- The Documents table's own page, for the same reason: the column the reader
-- clicked has to decide the page, not re-order it. Two things forced SQL here
-- rather than another PostgREST query.
--
-- The title lives in `frontmatter->>'title'`, and ordering it case-sensitively
-- puts every capital before every lowercase, so "Zebra" lands above "apple".
-- PostgREST cannot wrap an order in `lower()`.
--
-- And Status is three states, not a column: Excluded is the flag, but Ready
-- and Pending differ by whether the Document has chunks. Filtering on that
-- from the client meant fetching a page and filtering it, which gives a
-- footer count that disagrees with the rows under it. Here it is one exists().
create or replace function public.get_source_document_page(
  p_source_id text,
  p_page bigint,
  p_page_size bigint,
  p_sort text,
  p_ascending boolean,
  p_status text
) returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  with active as materialized (
    select
      c.id,
      c.path,
      c.frontmatter,
      c.excluded,
      c.created_at,
      lower(coalesce(nullif(c.frontmatter->>'title', ''), c.path)) as sort_title,
      exists (
        select 1 from public.concept_chunks k where k.concept_id = c.id
      ) as indexed
    from public.concepts c
    where c.source_id = p_source_id and c.is_active = true
  ), matching as materialized (
    select * from active
    where case p_status
      when 'excluded' then excluded
      when 'included' then not excluded
      when 'ready' then not excluded and indexed
      when 'pending' then not excluded and not indexed
      else true
    end
  ), page_rows as materialized (
    select *, row_number() over () as position
    from (
      select * from matching
      order by
        case when p_sort = 'title' and coalesce(p_ascending, false)
          then sort_title end asc nulls last,
        case when p_sort = 'title' and not coalesce(p_ascending, false)
          then sort_title end desc nulls last,
        case when coalesce(p_ascending, false) then created_at end asc,
        case when not coalesce(p_ascending, false) then created_at end desc,
        -- Two rows written in the same millisecond must not swap between
        -- pages, and the tie-break follows the direction so a flipped sort
        -- looks flipped all the way down.
        case when coalesce(p_ascending, false) then id end asc,
        id desc
      limit greatest(p_page_size, 0)
      offset (greatest(p_page, 1) - 1) * greatest(p_page_size, 0)
    ) ordered
  )
  select jsonb_build_object(
    'total', (select count(*) from matching),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'path', r.path,
        'title', coalesce(nullif(r.frontmatter->>'title', ''), r.path),
        'resourceUrl', r.frontmatter->>'resource',
        'excluded', coalesce(r.excluded, false),
        'indexed', r.indexed,
        'createdAt', r.created_at
      ) order by r.position)
      from page_rows r
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.get_source_document_page(text, bigint, bigint, text, boolean, text) from public, anon;
grant execute on function public.get_source_document_page(text, bigint, bigint, text, boolean, text) to authenticated, service_role;
