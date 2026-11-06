-- Document reviews and bounded, append-only FAQ versions (#1093, #1094).
create table public.faq_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_id text not null references public.sources(id) on delete cascade,
  question text not null,
  answer text not null,
  actor text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index faq_history_org_idx on public.faq_history(organization_id);
create index faq_history_source_time_idx on public.faq_history(source_id,created_at desc,id);
alter table public.faq_history enable row level security;
create policy faq_history_read on public.faq_history for select to authenticated using(private.is_org_member(organization_id));
revoke all on public.faq_history from public,anon,authenticated;
grant select on public.faq_history to authenticated;
grant all on public.faq_history to service_role;

create function private.record_document_text_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare org_id uuid;
begin
  if new.body is not distinct from old.body and
     (old.frontmatter->>'type' <> 'FAQ' or new.frontmatter->>'title' is not distinct from old.frontmatter->>'title')
     and coalesce(current_setting('ciele.document_edit_force',true),'') <> 'true' then return new; end if;
  new.frontmatter = new.frontmatter - 'verified';
  if old.frontmatter->>'type' = 'FAQ' and old.source_id is not null then
    select organization_id into org_id from public.knowledge_collections where id=old.collection_id;
    insert into public.faq_history(organization_id,source_id,question,answer,actor)
    values(org_id,old.source_id,coalesce(old.frontmatter->>'title',''),old.body,
      coalesce(nullif(current_setting('ciele.document_edit_actor',true),''), case when new.frontmatter->'generated' is distinct from old.frontmatter->'generated' then new.frontmatter->'generated'->>'by' end, case when auth.uid() is not null then 'human:' || auth.uid()::text else 'process:unknown' end));
    delete from public.faq_history where source_id=old.source_id and id in (
      select id from public.faq_history where source_id=old.source_id order by created_at desc,id desc offset 50
    );
  end if;
  return new;
end $$;
revoke all on function private.record_document_text_change() from public;
create trigger concept_text_review before update of body,frontmatter on public.concepts for each row execute function private.record_document_text_change();

-- Cutover still owns page identity. Carry reviews only when the text is identical.
create function private.carry_document_reviews() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.active_generation_id is not distinct from old.active_generation_id then return new; end if;
  update public.concepts incoming set frontmatter = (incoming.frontmatter - 'verified') ||
    case when incoming.body = prior.body and prior.frontmatter ? 'verified' then jsonb_build_object('verified',prior.frontmatter->'verified') else '{}'::jsonb end
  from (select distinct on(path) path,body,frontmatter from public.concepts
    where source_id=old.id and generation_id is not distinct from old.active_generation_id order by path,excluded desc,id) prior
  where incoming.source_id=old.id and incoming.generation_id=new.active_generation_id and incoming.path=prior.path;
  return new;
end $$;
revoke all on function private.carry_document_reviews() from public;
create trigger source_carry_document_reviews before update of active_generation_id on public.sources for each row execute function private.carry_document_reviews();

create function public.set_document_review(p_organization_id uuid,p_document_id text,p_member_id uuid,p_reviewed boolean) returns jsonb language plpgsql security definer set search_path = '' as $$
declare document public.concepts; events jsonb; actor text := 'human:' || p_member_id::text;
begin
  if coalesce((select auth.jwt())->>'role',current_setting('request.jwt.claim.role',true),'') <> 'service_role' and p_member_id is distinct from auth.uid() then raise exception 'Forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_member_id and role in ('owner','admin','editor')) then raise exception 'Forbidden' using errcode='42501'; end if;
  -- Serialize with source cutover so a review made during a crawl follows its text.
  perform 1 from public.sources s join public.concepts c on c.source_id=s.id where c.id=p_document_id for key share of s;
  select c.* into document from public.concepts c join public.knowledge_collections k on k.id=c.collection_id
    where c.id=p_document_id and k.organization_id=p_organization_id and c.is_active for update of c;
  if not found then raise exception 'Document not found' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(event),'[]'::jsonb) into events from jsonb_array_elements(
    case jsonb_typeof(document.frontmatter->'verified') when 'array' then document.frontmatter->'verified' when 'object' then jsonb_build_array(document.frontmatter->'verified') else '[]'::jsonb end
  ) event where event->>'by' is distinct from actor;
  if p_reviewed then events=events || jsonb_build_array(jsonb_build_object('by',actor,'at',clock_timestamp())); end if;
  update public.concepts set frontmatter=(frontmatter-'verified') || case when jsonb_array_length(events)>0 then jsonb_build_object('verified',events) else '{}'::jsonb end
    where id=p_document_id returning * into document;
  return to_jsonb(document);
end $$;
revoke all on function public.set_document_review(uuid,text,uuid,boolean) from public;
grant execute on function public.set_document_review(uuid,text,uuid,boolean) to authenticated,service_role;

-- The report touches only assistant answers in its 90-day observation window.
create index messages_citation_window_idx on public.messages(created_at,conversation_id)
  where role='assistant' and not (content @> '[{"type":"notification"}]'::jsonb);
create function public.get_source_usage(p_organization_id uuid,p_now timestamptz) returns jsonb
language sql stable security invoker set search_path='' as $$
with scoped_sources as materialized (
  select s.id from public.sources s join public.knowledge_collections k on k.id=s.collection_id where k.organization_id=p_organization_id
), cited as materialized (
  select distinct m.id,m.created_at,m.feedback,a.id as assistant_id,a.title as assistant_title,citation->>'sourceId' as source_id
  from public.messages m join public.conversations c on c.id=m.conversation_id
  join public.assistants a on a.id=c.assistant_id and a.organization_id=p_organization_id
  cross join lateral jsonb_array_elements(m.content) part
  cross join lateral jsonb_array_elements(case when jsonb_typeof(part->'sources')='array' then part->'sources' else '[]'::jsonb end) citation
  join scoped_sources s on s.id=citation->>'sourceId'
  where m.role='assistant' and c.teammate_id is null and c.subject_type <> 'member'
    and not (m.content @> '[{"type":"notification"}]'::jsonb)
    and m.created_at >= p_now-interval '90 days' and m.created_at <= p_now and part->>'type'='sources'
), totals as (
  select source_id,count(*) filter(where created_at>=p_now-interval '30 days') as cited30,
    count(*) filter(where created_at>=p_now-interval '30 days' and feedback=1) as positive30,
    count(*) filter(where created_at>=p_now-interval '30 days' and feedback=-1) as negative30,
    max(created_at) filter(where created_at>=p_now-interval '30 days') as last_cited
  from cited group by source_id
), per_assistant as (
  select source_id,assistant_id,assistant_title,count(*) as answers from cited
  where created_at>=p_now-interval '30 days' group by source_id,assistant_id,assistant_title
), assistant_lists as (
  select source_id,jsonb_agg(jsonb_build_object('id',assistant_id,'title',assistant_title,'answers',answers) order by assistant_id) as assistants
  from per_assistant group by source_id
)
select coalesce(jsonb_agg(jsonb_build_object(
  'sourceId',s.id,'cited30',coalesce(t.cited30,0),'positive30',coalesce(t.positive30,0),'negative30',coalesce(t.negative30,0),
  'lastCitedAt',to_char(t.last_cited at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'unused90',t.source_id is null,'assistants',coalesce(l.assistants,'[]'::jsonb)
) order by s.id),'[]'::jsonb)
from scoped_sources s left join totals t on t.source_id=s.id left join assistant_lists l on l.source_id=s.id;
$$;
revoke all on function public.get_source_usage(uuid,timestamptz) from public;
grant execute on function public.get_source_usage(uuid,timestamptz) to authenticated,service_role;

-- Library paging sorts and filters before selecting a page.
create or replace function public.get_library_quality_page(
  p_organization_id uuid,
  p_kinds text[],
  p_status text,
  p_assistant_id text,
  p_query text,
  p_page bigint,
  p_page_size bigint,
  p_sort text,
  p_ascending boolean,
  p_unused boolean
) returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  with usage as materialized (
    select entry->>'sourceId' as source_id,entry as stats from jsonb_array_elements(public.get_source_usage(p_organization_id,now())) entry
  ), matching as materialized (
    select
      s.id,
      s.status,
      s.created_at,
      coalesce(s.updated_at, s.created_at) as updated_at,
      lower(s.name) as sort_name,
      coalesce((u.stats->>'cited30')::bigint,0) as cited30
    from public.sources s
    join public.knowledge_collections k on k.id = s.collection_id
    left join usage u on u.source_id=s.id
    where k.organization_id = p_organization_id
      and (not coalesce(p_unused,false) or coalesce((u.stats->>'unused90')::boolean,true))
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
        case when p_sort='cited30' and coalesce(p_ascending,false) then cited30 end asc nulls last,
        case when p_sort='cited30' and not coalesce(p_ascending,false) then cited30 end desc nulls last,
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
    select s.*, p.position,u.stats as usage from public.sources s join page_ids p on p.id = s.id left join usage u on u.source_id=s.id
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
    'qualityAvailable',true,
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
        'usage',s.usage,
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

revoke execute on function public.get_library_quality_page(uuid, text[], text, text, text, bigint, bigint, text, boolean, boolean) from public, anon;
grant execute on function public.get_library_quality_page(uuid, text[], text, text, text, bigint, bigint, text, boolean, boolean) to authenticated, service_role;



create function private.document_trust_tier(frontmatter jsonb) returns text
language sql immutable set search_path='' as $$
  with events as (
    select e from jsonb_array_elements(case jsonb_typeof(frontmatter->'verified') when 'array' then frontmatter->'verified' when 'object' then jsonb_build_array(frontmatter->'verified') else '[]'::jsonb end) e
    where nullif(e->>'by','') is not null
  ) select case when exists(select 1 from events where e->>'by' like 'human:%') then 'human-reviewed'
    when exists(select 1 from events) then 'machine-confirmed' else 'unverified' end;
$$;
revoke all on function private.document_trust_tier(jsonb) from public;
grant execute on function private.document_trust_tier(jsonb) to authenticated,service_role;

create or replace function public.get_source_document_quality_page(
  p_source_id text,
  p_page bigint,
  p_page_size bigint,
  p_sort text,
  p_ascending boolean,
  p_status text,
  p_trust text
) returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  with active as materialized (
    select
      c.id,
      c.path,
      c.frontmatter,
      private.document_trust_tier(c.frontmatter) as trust_tier,
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
    where (p_trust is null or trust_tier=p_trust) and case p_status
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
        'trustTier',r.trust_tier,
        'resourceUrl', r.frontmatter->>'resource',
        'excluded', coalesce(r.excluded, false),
        'indexed', r.indexed,
        'createdAt', r.created_at
      ) order by r.position)
      from page_rows r
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.get_source_document_quality_page(text, bigint, bigint, text, boolean, text, text) from public, anon;
grant execute on function public.get_source_document_quality_page(text, bigint, bigint, text, boolean, text, text) to authenticated, service_role;

create function public.match_chunks_faqs(
  p_collection_ids text[],
  p_query_embedding vector(1536),
  p_match_count int default 6,
  p_embedding_space text default null
)
returns table (
  concept_id text,
  content text,
  similarity float
)
language plpgsql stable
as $$
begin
  if exists (
    select 1 from pg_extension
    where extname = 'vector'
      and (string_to_array(extversion, '.'))[1:2]::int[] >= array[0, 8]
  ) then
    perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  end if;
  return query
  select
    cc.concept_id,
    cc.content,
    1 - (cc.embedding <=> p_query_embedding) as similarity
  from public.concept_chunks cc
  join public.concepts c on c.id = cc.concept_id
  join public.sources s on s.id = c.source_id
  where s.kind = 'faq' and cc.embedding is not null
    and (
      p_embedding_space is null
      or cc.embedding_space is null
      or cc.embedding_space = p_embedding_space
    )
    and c.excluded = false
    and c.is_active = true
    and cc.collection_id = any(p_collection_ids)
  order by cc.embedding <=> p_query_embedding
  limit p_match_count;
end
$$;

alter function public.match_chunks_faqs(text[], vector, int, text)
  set search_path = public;


create function public.match_faq_chunks_lexical(p_collection_ids text[],p_tokens text[],p_question text,p_match_count integer default 30)
returns table(concept_id text, content text) language sql stable set search_path = '' as $$
  select cc.concept_id,cc.content from public.concept_chunks cc
  join public.concepts c on c.id=cc.concept_id join public.sources s on s.id=c.source_id
  where s.kind='faq' and c.is_active and not c.excluded and cc.collection_id=any(p_collection_ids)
    and exists(select 1 from unnest(p_tokens) t where cc.content ilike '%' || t || '%')
  order by (select count(*) from unnest(p_tokens) t where lower(c.frontmatter->>'title') like '%' || lower(t) || '%') desc,
    (lower(c.frontmatter->>'title') = lower(p_question)) desc, c.id,cc.id limit greatest(0,least(p_match_count,300));
$$;
revoke all on function public.match_chunks_faqs(text[],public.vector,integer,text) from public,anon;
revoke all on function public.match_faq_chunks_lexical(text[],text[],text,integer) from public,anon;
grant execute on function public.match_chunks_faqs(text[],public.vector,integer,text) to authenticated,service_role;
grant execute on function public.match_faq_chunks_lexical(text[],text[],text,integer) to authenticated,service_role;


-- Keep per-write authorship in the same transaction as the update. Equal clocks
-- and concurrent edits cannot make a current actor look like carried provenance.
create function public.edit_document(p_document_id text,p_frontmatter jsonb,p_body text,p_actor text,p_force_version boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb; previous_actor text := coalesce(current_setting('ciele.document_edit_actor',true),''); previous_force text := coalesce(current_setting('ciele.document_edit_force',true),'');
begin
  if p_actor is null or p_actor='' then raise exception 'An editing actor is required' using errcode='22023'; end if;
  perform set_config('ciele.document_edit_actor',p_actor,true);
  perform set_config('ciele.document_edit_force',p_force_version::text,true);
  update public.concepts set frontmatter=coalesce(p_frontmatter,frontmatter),body=coalesce(p_body,body)
  where id=p_document_id returning to_jsonb(concepts.*) into result;
  perform set_config('ciele.document_edit_actor',previous_actor,true);
  perform set_config('ciele.document_edit_force',previous_force,true);
  if result is null then raise exception 'Document not found' using errcode='42501'; end if;
  return result;
exception when others then
  perform set_config('ciele.document_edit_actor',previous_actor,true);
  perform set_config('ciele.document_edit_force',previous_force,true);
  raise;
end $$;
revoke all on function public.edit_document(text,jsonb,text,text,boolean) from public,anon;
grant execute on function public.edit_document(text,jsonb,text,text,boolean) to authenticated,service_role;
