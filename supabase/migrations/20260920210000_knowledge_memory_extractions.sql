-- The per-page extraction record (ticket ciele-org#930).
--
-- One row per page, not per Document row: `(source_id, document_path)` is the
-- identity that survives a re-crawl, the same pair `knowledge_memories` keys on
-- and `concepts_active_source_path_idx` indexes.
--
-- It does three jobs at once, which is why it is a table rather than three
-- columns somewhere:
--
--   1. The hash gate. A crawl stages a fresh generation every time, so "this
--      page did not change" is not otherwise knowable: the Document row is new
--      even when its text is identical. `body_hash` is what stops a weekly
--      re-crawl of an unchanged site paying for a model call per page, every
--      week, forever.
--   2. What the console reads. The Documents table's Memories column and the
--      Memories tab's empty state (#932, #933) need to tell "no memories" from
--      "not extracted yet" from "no Provider Connection", and only a record of
--      the attempt can.
--   3. What a failure leaves. `attempts`, `last_error` and `status` are the
--      breadcrumb; the ledger row is gone once the job settles.

create table if not exists public.knowledge_memory_extractions (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  collection_id text not null references public.knowledge_collections (id) on delete cascade,
  source_id text not null references public.sources (id) on delete cascade,
  document_path text not null,
  -- The body the last extraction actually read. Null while the first attempt
  -- is still pending, so a crash mid-attempt re-extracts rather than skipping.
  body_hash text,
  status text not null default 'pending'
    check (status in ('pending', 'done', 'skipped_no_provider', 'failed')),
  memory_count integer not null default 0 check (memory_count >= 0),
  -- The page held more facts than the cap allows, and the extra ones were
  -- dropped. Recorded rather than inferred, because "exactly twenty" and
  -- "twenty of forty" are different things to a Member reading the tab.
  capped boolean not null default false,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  extracted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, document_path)
);

-- The Source's records: the Alert aggregation reads failures per Source, and
-- the Documents table reads counts per page. Both walk the unique constraint's
-- own index on (source_id, document_path); a second one would be paid for on
-- every write and read by nothing.
create index if not exists knowledge_memory_extractions_collection_idx
  on public.knowledge_memory_extractions (collection_id);
create index if not exists knowledge_memory_extractions_failed_idx
  on public.knowledge_memory_extractions (source_id)
  where status = 'failed';

alter table public.knowledge_memory_extractions enable row level security;

-- Members read it (it is what the console's counts and empty states say);
-- writing is the job's, which runs on the service role. There is deliberately
-- no member write policy: nothing a person does should set an extraction's
-- status, and a policy would let any Member PATCH one through PostgREST.
drop policy if exists "members read knowledge memory extractions"
  on public.knowledge_memory_extractions;
create policy "members read knowledge memory extractions"
  on public.knowledge_memory_extractions
  for select using (private.is_org_member(organization_id));

comment on table public.knowledge_memory_extractions is
  'Per-page memory extraction record (#930): the hash gate, the console''s counts, and what a failure leaves.';

-- The new job kind: one per Document of a committed generation. The list also
-- carries `draft_goal_proposal`, which #909 added to the runtime's JobKind
-- without a migration: until here, a goal proposal job could not be inserted
-- on a database built from the chain.
alter table public.background_jobs
  drop constraint if exists background_jobs_kind_check;
alter table public.background_jobs
  add constraint background_jobs_kind_check
  check (kind in (
    'ingest_source',
    'graph_sync_concept',
    'draft_improvement_proposal',
    'draft_goal_proposal',
    'promote_memories',
    'distill_agent_memory',
    'sync_entity_records',
    'sync_application_import',
    'deliver_review_request',
    'resume_reviewed_conversation',
    'resume_webhook_conversation',
    'answer_slack_mention',
    'extract_document_memories'
  ));
