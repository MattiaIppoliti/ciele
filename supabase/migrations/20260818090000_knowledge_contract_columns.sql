-- Knowledge hub contract, step 2 (PRD #726, ticket #733), the column drops
-- that 20260816120000_retire_match_chunks deliberately deferred. From here
-- retrieval keys on the assistant↔source link table alone: an Assistant
-- answers from exactly the Sources linked to it.
--
-- `knowledge_collections.assistant_id` still survives: the per-assistant
-- Knowledge editor and the Publication collection snapshot key on it as a
-- grouping (ownership is already the Organization's via organization_id).
-- Its retirement rides with the editor re-parent follow-up.

-- 1. No Concept left behind: anything still source-less (hand-created rows
-- that predate "every knowledge item is a Source") gets a synthetic ready
-- `text` Source, so purely link-based retrieval keeps answering from it.
-- Deterministic ids make the step idempotent.
insert into public.sources (id, collection_id, name, kind, status, error, created_at)
select
  'textsrc-' || c.id,
  c.collection_id,
  coalesce(nullif(c.frontmatter->>'title', ''), c.path),
  'text',
  'ready',
  '',
  c.created_at
from public.concepts c
where c.source_id is null
on conflict (id) do nothing;

update public.concepts c
set source_id = s.id
from public.sources s
where s.id = 'textsrc-' || c.id
  and c.source_id is null;

-- 2. Link backstop: every Source carries at least its collection-assistant
-- link (editor adds created before auto-link landed, plus the synthetic
-- Sources above). Existing links, and their direct_access flags, are
-- untouched.
insert into public.assistant_sources (assistant_id, source_id)
select kc.assistant_id, s.id
from public.sources s
join public.knowledge_collections kc on kc.id = s.collection_id
where kc.assistant_id is not null
on conflict (assistant_id, source_id) do nothing;

-- 3. Belt-and-braces re-key before the column drop: any chunk that predates
-- the source_id stamp picks up its Concept's Source now.
update public.concept_chunks cc
set source_id = c.source_id
from public.concepts c
where c.id = cc.concept_id
  and cc.source_id is distinct from c.source_id;

-- 4. The one retrieval function goes link-only: the legacy
-- source-less-chunks-by-assistant predicate retires with the column.
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
    and exists (
      select 1 from public.assistant_sources ln
      where ln.assistant_id = p_assistant_id
        and ln.source_id = cc.source_id
    )
  order by cc.embedding <=> p_query_embedding
  limit p_match_count
$$;

alter function public.match_chunks_linked(text, text, vector, int) set search_path = public;

-- 5. Drop the denormalized assistant: first the 0005 policy that reads it
-- (the org-path chunk policies from 20260816110000 carry member access),
-- then the column, its index goes with it.
drop policy if exists "members all chunks" on public.concept_chunks;
alter table public.concept_chunks drop column if exists assistant_id;
