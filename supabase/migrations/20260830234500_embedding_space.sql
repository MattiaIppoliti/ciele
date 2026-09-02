-- Embedding-space identity on chunks (#801, CYB-14).
--
-- A cosine distance is only meaningful between vectors from the same model.
-- Chunks carried no record of which model embedded them, so a provider or
-- model change made every new query compare against a mix of historical
-- spaces, silently: nothing errored, retrieval just quietly ranked garbage.
--
-- Each chunk now names its space (`provider:model`, written at embed time),
-- and the three vector matchers take the query's space and refuse the
-- comparison across spaces. Legacy rows (null space, embedded before this
-- column existed) stay matchable: excluding them would blank retrieval for
-- every existing corpus overnight, and one unknown historical space is the
-- current one for any install that never changed models. Re-embedding
-- (the #312 backfill path) stamps them as it goes.

alter table public.concept_chunks
  add column if not exists embedding_space text;

comment on column public.concept_chunks.embedding_space is
  'Which model produced `embedding`, as provider:model. Null = embedded before this existed (treated as the current space) or not embedded at all.';

-- Adding a parameter changes the signature; CREATE OR REPLACE would leave the
-- old overload behind and PostgREST calls would turn ambiguous. Drop first.
drop function if exists public.match_chunks_linked(text, text, vector, int);
drop function if exists public.match_chunks_collections(text[], vector, int);
drop function if exists public.match_chunks_sources(text[], vector, int);

create function public.match_chunks_linked(
  p_assistant_id text,
  p_collection_id text,
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
  where cc.embedding is not null
    and (
      p_embedding_space is null
      or cc.embedding_space is null
      or cc.embedding_space = p_embedding_space
    )
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

alter function public.match_chunks_linked(text, text, vector, int, text)
  set search_path = public;

create function public.match_chunks_collections(
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
  where cc.embedding is not null
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

alter function public.match_chunks_collections(text[], vector, int, text)
  set search_path = public;

create function public.match_chunks_sources(
  p_source_ids text[],
  p_query_embedding vector(1536),
  p_match_count int default 6,
  p_embedding_space text default null
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
    and (
      p_embedding_space is null
      or cc.embedding_space is null
      or cc.embedding_space = p_embedding_space
    )
    and c.excluded = false
    and c.is_active = true
    and cc.source_id = any(p_source_ids)
  order by cc.embedding <=> p_query_embedding
  limit p_match_count;
end
$$;

alter function public.match_chunks_sources(text[], vector, int, text)
  set search_path = public;
