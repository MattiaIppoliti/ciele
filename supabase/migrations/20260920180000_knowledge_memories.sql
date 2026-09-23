-- Knowledge memories (spec ciele-org#910, decided in #911, ticket #926).
--
-- One standalone sentence extracted from a Document, forgettable and
-- verifiable. Its own table beside public.memories rather than a column on it:
-- a subject memory is a fact about a person, keyed to an SSO subject, promoted
-- from a Conversation and embedded for recall; this is a fact about a page,
-- keyed to the page, read back beside the Document it came from. They share one
-- word and nothing else, and #911 has the table of differences.
--
-- This migration makes the row exist, readable, forgettable and restorable.
-- The extraction job (#930, 20260920210000) writes it and the Memories tab
-- (#932) renders it.
--
-- Identity is the PAGE, not the page's row. A re-crawl is a generation swap
-- (20260828070100): every page is staged with a fresh random id and the retired
-- generation is deleted outright by the retention sweep. So the durable key is
-- (source_id, document_path), the same pair concepts_active_source_path_idx
-- indexes and the same pair 20260920100000 carries admin state across. The
-- concept_id below is a convenience for "the row I read this from", and it is
-- nullable with `on delete set null` precisely so the memory outlives the
-- generation it was extracted from.
--
-- Deliberately absent, each for a reason:
--
--   embedding        Retrieval over memories is a later effort. A vector column
--                    nothing reads is a promise the schema cannot keep, and
--                    the 1536-dim convention is one `alter table` away.
--   version chain    v1 keeps no per-memory history. The day a human can edit
--                    one, supermemory's names (is_latest, supersedes) are the
--                    ones to take; inventing them now fixes the wrong shape.
--   forget_after     The page is the authority on whether its memory still
--                    holds, not a clock. A knowledge memory dies when its page
--                    changes or a Member forgets it, and neither is a date.
--   static/dynamic   That split is a property of a person (#664's profile),
--                    not of a page.

create table if not exists public.knowledge_memories (
  id text primary key,
  -- Denormalised for the policies below and for any per-Organization sweep.
  -- Both are reachable by join; neither is reachable cheaply from a policy.
  organization_id uuid not null references public.organizations (id) on delete cascade,
  collection_id text not null references public.knowledge_collections (id) on delete cascade,
  -- The durable page identity. source_id cascades: a Source that is gone has no
  -- pages left to remember.
  source_id text not null references public.sources (id) on delete cascade,
  document_path text not null,
  -- The Document row this was read from, while that row lives.
  concept_id text references public.concepts (id) on delete set null,
  text text not null,
  -- The evidence pair: the verbatim span, and the chunk it sits in when the
  -- extractor worked chunk by chunk. The quote is the durable half.
  quote text not null default '',
  chunk_id text references public.concept_chunks (id) on delete set null,
  -- OKF `generated` (§5.2) as {by, at}: `<producer>/<version>` for a model,
  -- `human:<id>` for a person, `process:<id>` for a job. No confidence float;
  -- OKF records signals, not verdicts.
  generated_by text not null,
  generated_at timestamptz not null default now(),
  -- Forget is a STATE, not a delete: a Member undoes it. (The destructive verb
  -- belongs to subject memory, where it is called Erase, #925.)
  forgotten_at timestamptz,
  forget_reason text,
  forgotten_by uuid references auth.users (id) on delete set null,
  -- Bumped when a later extraction restates the same fact.
  source_count integer not null default 1 check (source_count >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The page's memories: the read #932 makes and the one #930 reconciles against.
create index if not exists knowledge_memories_page_idx
  on public.knowledge_memories (source_id, document_path, created_at desc);

-- Live rows per Collection: what a Collection currently remembers.
create index if not exists knowledge_memories_live_collection_idx
  on public.knowledge_memories (collection_id, created_at desc)
  where forgotten_at is null;

-- The two FKs' covering indexes (a delete resolves through them).
create index if not exists knowledge_memories_concept_idx
  on public.knowledge_memories (concept_id)
  where concept_id is not null;
create index if not exists knowledge_memories_forgotten_by_idx
  on public.knowledge_memories (forgotten_by)
  where forgotten_by is not null;

alter table public.knowledge_memories enable row level security;

-- The chunks table's rule, read off the denormalised column instead of through
-- the Collection: every Member of the Organization reads, an Editor writes.
-- Forgetting is an editorial act on the Organization's knowledge, so it sits at
-- the same rank as editing a Document.
drop policy if exists "members read knowledge memories" on public.knowledge_memories;
create policy "members read knowledge memories" on public.knowledge_memories
  for select using (private.is_org_member(organization_id));
drop policy if exists "editors create knowledge memories" on public.knowledge_memories;
create policy "editors create knowledge memories" on public.knowledge_memories
  for insert with check (private.has_org_role(organization_id, 2));
drop policy if exists "editors update knowledge memories" on public.knowledge_memories;
create policy "editors update knowledge memories" on public.knowledge_memories
  for update using (private.has_org_role(organization_id, 2));
drop policy if exists "editors delete knowledge memories" on public.knowledge_memories;
create policy "editors delete knowledge memories" on public.knowledge_memories
  for delete using (private.has_org_role(organization_id, 2));

comment on table public.knowledge_memories is
  'Knowledge memories (#926): one extracted sentence per Document, forgettable as a state.';
comment on column public.knowledge_memories.document_path is
  'The page identity that survives a re-crawl. (source_id, document_path) resolves to the current Document.';
comment on column public.knowledge_memories.forgotten_at is
  'Liveness: live iff null. Restoring clears it, which is why a forget is not a delete.';
