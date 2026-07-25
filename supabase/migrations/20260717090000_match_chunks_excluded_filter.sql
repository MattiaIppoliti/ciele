-- match_chunks: enforce concept exclusion in SQL (#311).
--
-- Per-page exclusion (concepts.excluded, added in 0008) was enforced only by
-- convention: the exclude action deletes the concept's chunks, and retrieval
-- would happily surface any chunk that survived. Join concepts and filter
-- excluded rows so exclusion holds even if chunks are ever retained
-- (chunk deletion stays as belt-and-braces).

create or replace function public.match_chunks(
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
language sql stable as $$
  select
    cc.concept_id,
    cc.content,
    1 - (cc.embedding <=> p_query_embedding) as similarity
  from public.concept_chunks cc
  join public.concepts c on c.id = cc.concept_id
  where cc.assistant_id = p_assistant_id
    and cc.embedding is not null
    and c.excluded = false
    and (p_collection_id is null or cc.collection_id = p_collection_id)
  order by cc.embedding <=> p_query_embedding
  limit p_match_count
$$;

alter function public.match_chunks(text, text, vector, int) set search_path = public;
