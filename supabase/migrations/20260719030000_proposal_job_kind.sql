-- Allow the Suggested Fix drafting job kind in the durable ledger (#390).
-- draft_improvement_proposal jobs draft a knowledge-fix proposal for an
-- Improvement; they carry no source_id.
alter table public.background_jobs
  drop constraint if exists background_jobs_kind_check;

alter table public.background_jobs
  add constraint background_jobs_kind_check
  check (kind in ('ingest_source', 'graph_sync_concept', 'draft_improvement_proposal'));
