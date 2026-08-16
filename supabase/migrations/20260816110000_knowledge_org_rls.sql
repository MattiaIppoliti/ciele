-- Knowledge hub backfill, step 1 of 2 (PRD #726, ticket #728): schema
-- relaxations + org-based RLS the org-owned rows need.
--
-- Collections stop requiring an owning assistant (the per-org "Knowledge
-- Library" default collection has none); the column itself survives until the
-- contract step (#733). The legacy assistant-routed policies stay — these
-- org-routed ones OR alongside them so org-owned rows (assistant_id null)
-- are reachable by their organization's members. Reads are member-tier,
-- writes editor-tier (rank 2), matching the collection policies rather than
-- the looser legacy source/concept/chunk ones.

alter table public.knowledge_collections
  alter column assistant_id drop not null;

drop policy if exists "members read org collections" on public.knowledge_collections;
create policy "members read org collections" on public.knowledge_collections
  for select using (
    organization_id is not null and private.is_org_member(organization_id)
  );

drop policy if exists "editors write org collections" on public.knowledge_collections;
create policy "editors write org collections" on public.knowledge_collections
  for all using (
    organization_id is not null and private.has_org_role(organization_id, 2)
  );

drop policy if exists "members org sources" on public.sources;
drop policy if exists "members read org sources" on public.sources;
create policy "members read org sources" on public.sources
  for select using (exists (
    select 1 from public.knowledge_collections kc
    where kc.id = sources.collection_id
      and kc.organization_id is not null
      and private.is_org_member(kc.organization_id)
  ));

drop policy if exists "editors write org sources" on public.sources;
create policy "editors write org sources" on public.sources
  for all using (exists (
    select 1 from public.knowledge_collections kc
    where kc.id = sources.collection_id
      and kc.organization_id is not null
      and private.has_org_role(kc.organization_id, 2)
  ));

drop policy if exists "members org concepts" on public.concepts;
drop policy if exists "members read org concepts" on public.concepts;
create policy "members read org concepts" on public.concepts
  for select using (exists (
    select 1 from public.knowledge_collections kc
    where kc.id = concepts.collection_id
      and kc.organization_id is not null
      and private.is_org_member(kc.organization_id)
  ));

drop policy if exists "editors write org concepts" on public.concepts;
create policy "editors write org concepts" on public.concepts
  for all using (exists (
    select 1 from public.knowledge_collections kc
    where kc.id = concepts.collection_id
      and kc.organization_id is not null
      and private.has_org_role(kc.organization_id, 2)
  ));

drop policy if exists "members org chunks" on public.concept_chunks;
drop policy if exists "members read org chunks" on public.concept_chunks;
create policy "members read org chunks" on public.concept_chunks
  for select using (exists (
    select 1 from public.knowledge_collections kc
    where kc.id = concept_chunks.collection_id
      and kc.organization_id is not null
      and private.is_org_member(kc.organization_id)
  ));

drop policy if exists "editors write org chunks" on public.concept_chunks;
create policy "editors write org chunks" on public.concept_chunks
  for all using (exists (
    select 1 from public.knowledge_collections kc
    where kc.id = concept_chunks.collection_id
      and kc.organization_id is not null
      and private.has_org_role(kc.organization_id, 2)
  ));
