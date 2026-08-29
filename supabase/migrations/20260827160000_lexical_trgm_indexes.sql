-- Trigram indexes under the lexical safety net.
--
-- searchChunks and searchMemories top up vector hits with a lexical pass
-- (packages/db/src/hybrid-search.ts): an OR of `content ilike '%token%'`
-- per query token. A leading-wildcard ILIKE cannot use a btree, so every
-- top-up is a sequential scan today, and it runs inside the Visitor's turn
-- latency, in exactly the moment the vector index under-filled. Free at the
-- current row counts; at real corpus size it is the worst cost paid at the
-- worst time.
--
-- pg_trgm's GIN operator class serves leading-wildcard ILIKE directly, so the
-- existing queries use these indexes with no code change. The extension goes
-- in `extensions`, where Supabase puts extensions and where `vector` should
-- have gone (that move is flagged, and is a migration of its own).
--
-- Write cost, considered: a GIN trgm index makes chunk/memory INSERTs pay
-- trigram extraction. Both tables are ingestion-written (batch, background),
-- not Visitor-written, so the write path that pays is the one that can.

-- Hosted Supabase has the `extensions` schema; a bare self-host Postgres or
-- the pglite contract harness may not. Creating it here keeps the migration
-- true on all three databases the chain must build.
create schema if not exists extensions;

create extension if not exists pg_trgm with schema extensions;

create index if not exists concept_chunks_content_trgm_idx
  on public.concept_chunks using gin (content extensions.gin_trgm_ops);

create index if not exists memories_text_trgm_idx
  on public.memories using gin (text extensions.gin_trgm_ops);
