-- A Teammate's Knowledge Scope reaches individual Library items, not only whole
-- Collections (spec ciele-org#767, follow-up to #768/#769).
--
-- Until now the scope was a list of Collection ids, so "let this teammate read
-- the handbook PDF and the refunds FAQ" had no expression short of building a
-- Collection for it. The Library already lists the Organization's Sources by
-- kind (websites, files, FAQs, PRD #726); this makes that same list selectable.
--
-- Two lists rather than one polymorphic column: a Collection and a Source are
-- different nouns, retrieval filters on different columns for each, and a single
-- `scope_ids` array would need a discriminator beside it that could disagree
-- with its contents. Same shape as `collection_ids` otherwise, and for the same
-- reasons: not a FK table, because an empty scope is a valid configuration and a
-- dangling id raises an Alert instead of rewriting somebody's Teammate under
-- them (#769).

alter table public.teammates
  add column if not exists source_ids jsonb not null default '[]'::jsonb;

-- Source-scoped retrieval -----------------------------------------------------
--
-- The sibling of `match_chunks_collections` (#768), filtering on the chunk's
-- Source instead of its Collection. Everything else is identical, the
-- excluded-Concept filter, cosine ordering, the 1536-dim convention, so a
-- citation looks the same whichever of the three searches produced it
-- (ADR-0002). A chunk with no Source is unreachable here by construction, which
-- is the same rule assistant retrieval already applies (#733).
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
language sql stable as $$
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
  limit p_match_count
$$;

alter function public.match_chunks_sources(text[], vector, int)
  set search_path = public;
