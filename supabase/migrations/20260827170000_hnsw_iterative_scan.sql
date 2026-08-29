-- Iterative HNSW scans for the filtered vector searches (scaling pass).
--
-- All four match_* functions run an ORDER BY embedding <=> query LIMIT k
-- under a filter (assistant link, collection list, source list, or
-- organization + subject) against ONE shared HNSW index that holds every
-- tenant's vectors. An HNSW scan collects a fixed candidate set
-- (hnsw.ef_search, default 40) BEFORE the filter applies, so as tenants grow
-- the candidates are increasingly other tenants' rows, the filter discards
-- them, and a small Collection in a large table under-returns or returns
-- nothing: recall decays with everyone else's data, which is the opposite of
-- tenant isolation. Today the lexical safety net masks the gap; it should be
-- the fallback, not the load-bearer.
--
-- pgvector 0.8 added iterative scans for exactly this shape: when the filter
-- leaves fewer than the requested rows, the scan resumes deeper into the
-- graph instead of giving up (bounded by hnsw.max_scan_tuples, default
-- 20000, so a filter matching nothing cannot walk the whole index).
-- `relaxed_order` may yield slightly out-of-order results between resume
-- batches; these consumers assemble RAG context and treat the lexical
-- top-up's constant 0.5 as a similarity, so exact rank order is already not
-- an invariant here. The live project runs pgvector 0.8.2 (observed).
--
-- Why set_config inside the body and not ALTER FUNCTION ... SET: Supabase's
-- supautils restricts which parameters the `postgres` role may attach to a
-- role or function ("permission denied to set parameter"), on the hosted
-- project and on the self-host image alike, and this repo's applier runs as
-- exactly that role. A transaction-local set_config at execution time is the
-- session-level SET the platform does allow. `local = true` scopes it to the
-- calling transaction, which for a PostgREST RPC is the request.
--
-- The pg_extension probe guards the call at runtime: on pgvector < 0.8 the
-- GUC does not exist (`hnsw.` is a reserved prefix there, so setting it
-- throws), the probe skips it, and behavior stays what those databases have
-- today, a fixed-candidate scan. One catalog-cache lookup per call.
--
-- These CREATE OR REPLACE bodies are otherwise verbatim from their previous
-- definitions (20260818090000, 20260821140000, 20260826120000,
-- 20260808100000); a replaced function loses its proconfig, so the
-- search_path pin is restated on each.

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
    and cc.source_id = any(p_source_ids)
  order by cc.embedding <=> p_query_embedding
  limit p_match_count;
end
$$;

alter function public.match_chunks_sources(text[], vector, int)
  set search_path = public;

create or replace function public.match_memories(
  p_organization_id uuid,
  p_subject_id text,
  p_query_embedding vector(1536),
  p_match_count int default 5
)
returns table (
  id text,
  text text,
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
    m.id,
    m.text,
    1 - (m.embedding <=> p_query_embedding) as similarity
  from public.memories m
  where m.organization_id = p_organization_id
    and m.subject_id = p_subject_id
    and m.embedding is not null
  order by m.embedding <=> p_query_embedding
  limit p_match_count;
end
$$;

alter function public.match_memories(uuid, text, vector, int)
  set search_path = public;
