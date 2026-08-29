-- Knowledge hub expand, step 3 of 3 (PRD #726, ticket #727).
--
-- A VARIANT of match_chunks that scopes by the assistant↔source link table:
-- a chunk that knows its Source answers for exactly the Assistants linked to
-- that Source; a legacy chunk (source_id null, pre-backfill) falls back to
-- the denormalized assistant_id, so behavior is unchanged until links exist.
-- match_chunks itself is untouched here; it is retired by the contract step
-- (#733) once the backfill has stamped every chunk.

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
language sql stable as $$
  select
    cc.concept_id,
    cc.content,
    1 - (cc.embedding <=> p_query_embedding) as similarity
  from public.concept_chunks cc
  join public.concepts c on c.id = cc.concept_id
  where cc.embedding is not null
    and c.excluded = false
    and (p_collection_id is null or cc.collection_id = p_collection_id)
    and (
      case
        when cc.source_id is null then cc.assistant_id = p_assistant_id
        else exists (
          select 1 from public.assistant_sources l
          where l.source_id = cc.source_id
            and l.assistant_id = p_assistant_id
        )
      end
    )
  order by cc.embedding <=> p_query_embedding
  limit p_match_count
$$;

alter function public.match_chunks_linked(text, text, vector, int) set search_path = public;
