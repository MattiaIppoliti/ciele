-- Backfill: reproduces migration 20260710102020 "source_show_in_citations",
-- which was applied directly to the live project (via the Supabase MCP
-- apply_migration tool) without a corresponding local file. Statements below
-- are copied verbatim from supabase_migrations.schema_migrations.statements
-- for that version. See CLAUDE.md §10 for the earlier 0023–0028 backfills of
-- the same remote→local drift class.

-- Per-source Sources visibility: uploaded documents can be hidden from the
-- citation list under AI answers (the knowledge is still used to answer —
-- only the chip is suppressed). Website sources keep the default true, so
-- crawled pages/PDFs are always citable.
alter table public.sources
  add column show_in_citations boolean not null default true;
