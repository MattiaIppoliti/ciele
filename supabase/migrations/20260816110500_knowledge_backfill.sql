-- Knowledge hub backfill, step 2 of 2 (PRD #726, ticket #728): data movement
-- only, no drops, and idempotent throughout (deterministic synthetic ids +
-- on-conflict/no-op guards), so re-running on a partially backfilled database
-- is safe. Retrieval behavior is unchanged by construction: every backfilled
-- chunk's Source is linked to exactly the assistant the chunk was already
-- scoped to.

-- 1. Collections learn their Organization from the owning assistant.
update public.knowledge_collections kc
set organization_id = a.organization_id
from public.assistants a
where a.id = kc.assistant_id
  and kc.organization_id is null;

-- 2. Every legacy FAQ Concept (frontmatter.type = "FAQ", no Source) gets a
--    synthetic `faq` Source so linking/status/timestamps are uniform across
--    the hub tabs. Deterministic id ⇒ re-runs cannot duplicate.
insert into public.sources
  (id, collection_id, name, kind, status, error, config, recrawl_schedule,
   created_at, updated_at)
select
  'faqsrc-' || c.id,
  c.collection_id,
  coalesce(nullif(c.frontmatter->>'title', ''), 'FAQ'),
  'faq',
  'ready',
  '',
  '{}'::jsonb,
  'never',
  c.created_at,
  c.created_at
from public.concepts c
where c.source_id is null
  and c.frontmatter->>'type' = 'FAQ'
on conflict (id) do nothing;

update public.concepts c
set source_id = 'faqsrc-' || c.id
where c.source_id is null
  and c.frontmatter->>'type' = 'FAQ'
  and exists (
    select 1 from public.sources s where s.id = 'faqsrc-' || c.id
  );

-- 3. One link per existing Source, to its original assistant. Direct access
--    stays off everywhere, the migration must never silently expose a file.
insert into public.assistant_sources (assistant_id, source_id, direct_access, created_at)
select kc.assistant_id, s.id, false, s.created_at
from public.sources s
join public.knowledge_collections kc on kc.id = s.collection_id
where kc.assistant_id is not null
on conflict (assistant_id, source_id) do nothing;

-- 4. Chunks learn their Source from their Concept. Chunks of source-less
--    Concepts stay legacy (scoped by assistant_id) until they have one.
update public.concept_chunks cc
set source_id = c.source_id
from public.concepts c
where c.id = cc.concept_id
  and cc.source_id is null
  and c.source_id is not null;

-- 5. The per-org default collection future hub-created items land in.
--    Deterministic id ⇒ idempotent; orgs created later get theirs lazily
--    from the hub's add flows.
insert into public.knowledge_collections
  (id, assistant_id, organization_id, name, description)
select
  'org-library-' || o.id,
  null,
  o.id,
  'Knowledge Library',
  'Organization-wide knowledge added from the Knowledge hub'
from public.organizations o
on conflict (id) do nothing;
