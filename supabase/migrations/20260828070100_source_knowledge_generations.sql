-- Source replacement uses generation visibility rather than create-then-delete
-- visibility. A complete generation is staged with is_active=false; one
-- compare-and-swap flips the Source and its Concepts in a transaction. Readers
-- therefore see the old complete set or the new complete set, never a mixture.

alter table public.sources
  add column if not exists active_generation_id uuid not null default gen_random_uuid();

alter table public.concepts
  add column if not exists generation_id uuid,
  add column if not exists is_active boolean not null default true;

alter table public.concepts
  add column if not exists staging_key text generated always as (
    case
      when is_active = false and generation_id is not null
        then md5(coalesce(source_id, '') || ':' || generation_id::text || ':' || path)
      else null
    end
  ) stored;

update public.concepts c
set generation_id = s.active_generation_id,
    is_active = true
from public.sources s
where s.id = c.source_id
  and c.generation_id is null;

create index if not exists concepts_active_source_path_idx
  on public.concepts (source_id, path, id)
  where is_active = true;

create index if not exists concepts_source_generation_idx
  on public.concepts (source_id, generation_id, id);

create unique index if not exists concepts_staging_key_uidx
  on public.concepts (staging_key);

-- Ordinary one-off Concept inserts join the Source's active generation.
-- Ingestion supplies a fresh generation_id explicitly, which keeps that row
-- inactive until commit_source_knowledge_generation activates the whole set.
create or replace function private.assign_concept_generation()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.source_id is not null and new.generation_id is null then
    select s.active_generation_id
      into new.generation_id
    from public.sources s
    where s.id = new.source_id;
  end if;
  return new;
end;
$$;

drop trigger if exists concepts_assign_generation on public.concepts;
create trigger concepts_assign_generation
before insert on public.concepts
for each row execute function private.assign_concept_generation();

-- A staged page may be replayed after a worker crash. Keep the original id so
-- its chunks can be replaced deterministically; a PostgREST table upsert would
-- otherwise update the primary key from the retried insert payload.
create or replace function public.stage_source_concept(
  p_id text,
  p_collection_id text,
  p_source_id text,
  p_generation_id uuid,
  p_path text,
  p_frontmatter jsonb,
  p_body text
)
returns setof public.concepts
language sql
volatile
security invoker
set search_path = public
as $$
  insert into public.concepts (
    id, collection_id, source_id, generation_id, is_active,
    path, frontmatter, body
  ) values (
    p_id, p_collection_id, p_source_id, p_generation_id, false,
    p_path, p_frontmatter, p_body
  )
  on conflict (staging_key) do update
    set collection_id = excluded.collection_id,
        frontmatter = excluded.frontmatter,
        body = excluded.body
  returning *;
$$;

revoke all on function public.stage_source_concept(
  text, text, text, uuid, text, jsonb, text
) from public, anon;
grant execute on function public.stage_source_concept(
  text, text, text, uuid, text, jsonb, text
) to authenticated, service_role;

create or replace function public.commit_source_knowledge_generation(
  p_source_id text,
  p_expected_active_generation_id uuid,
  p_generation_id uuid
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_active_generation_id uuid;
begin
  select s.active_generation_id
    into v_active_generation_id
  from public.sources s
  where s.id = p_source_id
  for update;

  if not found or v_active_generation_id is distinct from p_expected_active_generation_id then
    return false;
  end if;

  if not exists (
    select 1
    from public.concepts c
    where c.source_id = p_source_id
      and c.generation_id = p_generation_id
  ) then
    return false;
  end if;

  update public.concepts
  set is_active = false
  where source_id = p_source_id
    and is_active = true;

  update public.concepts
  set is_active = true
  where source_id = p_source_id
    and generation_id = p_generation_id;

  update public.sources
  set active_generation_id = p_generation_id,
      updated_at = now()
  where id = p_source_id;

  return true;
end;
$$;

revoke all on function public.commit_source_knowledge_generation(
  text, uuid, uuid
) from public, anon;
grant execute on function public.commit_source_knowledge_generation(
  text, uuid, uuid
) to authenticated, service_role;

-- Both vector retrieval paths join Concepts already; the active predicate is
-- the only extra work and is backed by the partial index above.
create or replace function public.match_chunks_linked(
  p_assistant_id text,
  p_collection_id text,
  p_query_embedding vector(1536),
  p_match_count int default 6
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
  where cc.embedding is not null
    and c.excluded = false
    and c.is_active = true
    and (p_collection_id is null or cc.collection_id = p_collection_id)
    and exists (
      select 1 from public.assistant_sources ln
      where ln.assistant_id = p_assistant_id
        and ln.source_id = cc.source_id
    )
  order by cc.embedding <=> p_query_embedding
  limit p_match_count;
end
$$;

alter function public.match_chunks_linked(text, text, vector, int)
  set search_path = public;

create or replace function public.match_chunks_collections(
  p_collection_ids text[],
  p_query_embedding vector(1536),
  p_match_count int default 6
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
  where cc.embedding is not null
    and c.excluded = false
    and c.is_active = true
    and cc.collection_id = any(p_collection_ids)
  order by cc.embedding <=> p_query_embedding
  limit p_match_count;
end
$$;

alter function public.match_chunks_collections(text[], vector, int)
  set search_path = public;

create or replace function public.match_chunks_sources(
  p_source_ids text[],
  p_query_embedding vector(1536),
  p_match_count int default 6
)
returns table (
  concept_id text,
  content text,
  similarity float
)
language plpgsql stable as $$
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
  where cc.embedding is not null
    and c.excluded = false
    and c.is_active = true
    and cc.source_id = any(p_source_ids)
  order by cc.embedding <=> p_query_embedding
  limit p_match_count;
end
$$;

alter function public.match_chunks_sources(text[], vector, int)
  set search_path = public;
