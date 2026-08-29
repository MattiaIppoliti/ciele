-- Per-assistant access reaches the knowledge tables (PRD #296, the child-table
-- work #300 that 20260716120000_assistant_access deferred).
--
-- Until now `private.has_assistant_role` gated exactly one thing, the
-- assistants SELECT policy: knowledge was governed by the Organization role
-- alone, so a member with `denied` on an Assistant could still delete the
-- Sources it answers from, from either the Library or that Assistant's editor.
--
-- The rule, in one sentence per verb:
--
--   read   a Source: any linked Assistant the caller can see is enough.
--   write  a Source: every linked Assistant must be writable, because renaming
--          or deleting it changes what all of them answer.
--   create knowledge: editor rank on the Organization, or on at least one of
--          its Assistants, a Source has no links yet at insert time, so this
--          is the only thing there is to check.
--   link/unlink: editor rank on that one Assistant. This is the escape hatch
--          the editor's "remove from this assistant" needs: taking a shared
--          Source off your own Assistant never requires rights on the others.
--
-- Nothing changes for a deployment with no override rows: `has_assistant_role`
-- falls back to the org role, so every plain Editor keeps writing every Source
-- exactly as before. Only explicit `denied` / `viewer` overrides bite.
--
-- Cost: these predicates run per row, source → links → assistants → members.
-- The admin console reads knowledge a page at a time; published widget traffic
-- runs on the service role and never enters RLS at all.

-- 1. Resolvers ---------------------------------------------------------------

-- The Organization behind a Source, or null. Collections are org-owned since
-- the #726 contract, so this is a plain two-hop lookup.
create or replace function private.source_org(p_source_id text)
returns uuid language sql stable security definer set search_path = public as $$
  select kc.organization_id
  from public.sources s
  join public.knowledge_collections kc on kc.id = s.collection_id
  where s.id = p_source_id
$$;

-- May the caller create knowledge in this Organization? Editor on the org, or
-- editor on any one of its Assistants (an override can raise a member the org
-- role alone would refuse).
create or replace function private.can_create_org_knowledge(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_org is not null and (
    private.has_org_role(p_org, 2)
    or exists (
      select 1 from public.assistants a
      where a.organization_id = p_org
        and private.has_assistant_role(a.id, 2)
    )
  )
$$;

-- Read reach: one visible linked Assistant is enough. An unlinked Source (the
-- moment between createSource and the first link, and any Source the Library
-- has unlinked from everything) falls back to plain org membership.
create or replace function private.can_read_source(p_source_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when exists (
      select 1 from public.assistant_sources l where l.source_id = p_source_id
    ) then exists (
      select 1 from public.assistant_sources l
      where l.source_id = p_source_id
        and private.has_assistant_role(l.assistant_id, 1)
    )
    else private.is_org_member(private.source_org(p_source_id))
  end
$$;

-- Write reach: EVERY linked Assistant must be writable. A Source linked to an
-- Assistant the caller cannot edit is one they must not rename or delete,
-- they can still unlink it from their own Assistant.
create or replace function private.can_write_source(p_source_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when exists (
      select 1 from public.assistant_sources l where l.source_id = p_source_id
    ) then not exists (
      select 1 from public.assistant_sources l
      where l.source_id = p_source_id
        and not private.has_assistant_role(l.assistant_id, 2)
    )
    else private.can_create_org_knowledge(private.source_org(p_source_id))
  end
$$;

-- 2. sources -----------------------------------------------------------------
-- The #726 org-routed policies split per verb: reads follow the links, writes
-- need every link, inserts have no links to follow yet.

drop policy if exists "members read org sources" on public.sources;
create policy "members read org sources" on public.sources
  for select using (private.can_read_source(id));

drop policy if exists "editors write org sources" on public.sources;
drop policy if exists "editors insert org sources" on public.sources;
create policy "editors insert org sources" on public.sources
  for insert with check (exists (
    select 1 from public.knowledge_collections kc
    where kc.id = sources.collection_id
      and private.can_create_org_knowledge(kc.organization_id)
  ));

drop policy if exists "editors update org sources" on public.sources;
create policy "editors update org sources" on public.sources
  for update using (private.can_write_source(id))
  with check (exists (
    select 1 from public.knowledge_collections kc
    where kc.id = sources.collection_id
      and private.can_create_org_knowledge(kc.organization_id)
  ));

drop policy if exists "editors delete org sources" on public.sources;
create policy "editors delete org sources" on public.sources
  for delete using (private.can_write_source(id));

-- 3. concepts ----------------------------------------------------------------
-- A Concept inherits its Source's reach. `source_id` is never null after the
-- #733 backfill; the fallback keeps a hand-written row from becoming
-- unreachable if one ever appears again.

drop policy if exists "members read org concepts" on public.concepts;
create policy "members read org concepts" on public.concepts
  for select using (
    case
      when source_id is not null then private.can_read_source(source_id)
      else exists (
        select 1 from public.knowledge_collections kc
        where kc.id = concepts.collection_id
          and private.is_org_member(kc.organization_id)
      )
    end
  );

drop policy if exists "editors write org concepts" on public.concepts;
create policy "editors write org concepts" on public.concepts
  for all using (
    case
      when source_id is not null then private.can_write_source(source_id)
      else exists (
        select 1 from public.knowledge_collections kc
        where kc.id = concepts.collection_id
          and private.can_create_org_knowledge(kc.organization_id)
      )
    end
  )
  with check (exists (
    select 1 from public.knowledge_collections kc
    where kc.id = concepts.collection_id
      and private.can_create_org_knowledge(kc.organization_id)
  ));

-- 4. concept_chunks ----------------------------------------------------------

drop policy if exists "members read org chunks" on public.concept_chunks;
create policy "members read org chunks" on public.concept_chunks
  for select using (
    case
      when source_id is not null then private.can_read_source(source_id)
      else exists (
        select 1 from public.knowledge_collections kc
        where kc.id = concept_chunks.collection_id
          and private.is_org_member(kc.organization_id)
      )
    end
  );

drop policy if exists "editors write org chunks" on public.concept_chunks;
create policy "editors write org chunks" on public.concept_chunks
  for all using (
    case
      when source_id is not null then private.can_write_source(source_id)
      else exists (
        select 1 from public.knowledge_collections kc
        where kc.id = concept_chunks.collection_id
          and private.can_create_org_knowledge(kc.organization_id)
      )
    end
  )
  with check (exists (
    select 1 from public.knowledge_collections kc
    where kc.id = concept_chunks.collection_id
      and private.can_create_org_knowledge(kc.organization_id)
  ));

-- 5. assistant_sources ------------------------------------------------------
-- The link row is per-Assistant by definition, so it is the one place where
-- rights on that single Assistant are the whole test.

drop policy if exists "members read assistant sources" on public.assistant_sources;
create policy "members read assistant sources" on public.assistant_sources
  for select using (private.has_assistant_role(assistant_id, 1));

drop policy if exists "editors write assistant sources" on public.assistant_sources;
create policy "editors write assistant sources" on public.assistant_sources
  for all using (private.has_assistant_role(assistant_id, 2))
  with check (
    private.has_assistant_role(assistant_id, 2)
    -- Cross-org linking stays impossible: the Source's Organization must be
    -- the Assistant's own (carried over from the #726 contract policy).
    and exists (
      select 1 from public.assistants a
      where a.id = assistant_sources.assistant_id
        and a.organization_id = private.source_org(assistant_sources.source_id)
    )
  );

-- 6. knowledge_collections ---------------------------------------------------
-- Collections are org-level containers, not per-assistant, so membership still
-- decides reads. Writes accept the assistant-editor path so a member whose only
-- editor rank comes from an override can still create the Library row.

drop policy if exists "editors write org collections" on public.knowledge_collections;
create policy "editors write org collections" on public.knowledge_collections
  for all using (private.can_create_org_knowledge(organization_id))
  with check (private.can_create_org_knowledge(organization_id));
