-- Knowledge hub expand, step 2 of 3 (PRD #726, ticket #727).
--
-- The assistant↔knowledge link: which Assistants may answer from a Source,
-- plus the per-assistant Direct access flag (may chat users open the cited
-- file itself). One row per (assistant, source) pair; deleting either side
-- removes the link. Embeddings stay stored once per Concept — this table is
-- what shares them across Assistants.

create table public.assistant_sources (
  assistant_id text not null references public.assistants (id) on delete cascade,
  source_id text not null references public.sources (id) on delete cascade,
  direct_access boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (assistant_id, source_id)
);

create index assistant_sources_source_idx on public.assistant_sources (source_id);

alter table public.assistant_sources enable row level security;

-- Read is org-member, write is editor+ — scoped through the linked assistant's
-- organization. The write check also pins the Source to the SAME organization
-- (via its collection's org id, falling back to the legacy assistant chain
-- while the backfill hasn't stamped collections yet), so an editor can never
-- link their assistant to another organization's knowledge.
create policy "members read assistant sources" on public.assistant_sources
  for select using (exists (
    select 1 from public.assistants a
    where a.id = assistant_sources.assistant_id
      and private.is_org_member(a.organization_id)
  ));

create policy "editors write assistant sources" on public.assistant_sources
  for all using (exists (
    select 1 from public.assistants a
    where a.id = assistant_sources.assistant_id
      and private.has_org_role(a.organization_id, 2)
  ))
  with check (exists (
    select 1
    from public.assistants a, public.sources s
    join public.knowledge_collections kc on kc.id = s.collection_id
    left join public.assistants owner on owner.id = kc.assistant_id
    where a.id = assistant_sources.assistant_id
      and s.id = assistant_sources.source_id
      and private.has_org_role(a.organization_id, 2)
      and coalesce(kc.organization_id, owner.organization_id) = a.organization_id
  ));
