-- Knowledge hub expand, step 1 of 3 (PRD #726, ticket #727).
--
-- Knowledge ownership moves from the Assistant to the Organization via an
-- expand–contract migration (template: the API-integrations chain). This is
-- the EXPAND half: every column is additive and nullable, nothing existing is
-- dropped or renamed, and no existing RPC changes, production behavior is
-- byte-for-byte identical until the backfill (#728) and contract (#733) land.

-- Collections become org-owned. Nullable during expand: the adapter stamps it
-- on every new row, and the backfill fills history from the owning assistant.
alter table public.knowledge_collections
  add column organization_id uuid references public.organizations (id) on delete cascade;

create index knowledge_collections_organization_idx
  on public.knowledge_collections (organization_id);

-- New Source kind: a FAQ is a Source whose name is the question; the answer
-- stays on its Concept (frontmatter.type = "FAQ"), so findFaqConcept and the
-- widget FAQ quick-reply keep working unchanged.
alter table public.sources drop constraint sources_kind_check;
alter table public.sources
  add constraint sources_kind_check
  check (kind in ('file', 'url', 'text', 'website', 'faq'));

-- Chunks learn which Source they came from so retrieval can follow the
-- assistant↔source link table instead of the denormalized assistant_id
-- (which the contract step will drop). Nullable during expand: null means
-- "legacy chunk, scope by assistant_id as before".
alter table public.concept_chunks
  add column source_id text references public.sources (id) on delete cascade;

create index concept_chunks_source_idx on public.concept_chunks (source_id);
