-- Allow the graph-sync job kind in the durable ledger. graph_sync_concept jobs
-- project one OKF Concept onto its Collection's derived Knowledge Graph
-- (ADR-0017); they carry no source_id (a Concept can be an FAQ with no Source).
--
-- The kind check was created inline in 0041_background_jobs.sql, so Postgres
-- auto-named it background_jobs_kind_check. Replace it with the widened set.

alter table public.background_jobs
  drop constraint if exists background_jobs_kind_check;

alter table public.background_jobs
  add constraint background_jobs_kind_check
  check (kind in ('ingest_source', 'graph_sync_concept'));
