-- A chunk knows where in its Document it came from (ticket ciele-org#929).
--
-- The Chunks tab numbers a Document's chunks `01`, `02`, … and claims that is
-- their order in the body. Nothing in the schema carried that. `saveChunks`
-- does insert in body order, but every row takes a random `shortId()` and
-- `created_at` defaults to `now()`, which in Postgres is transaction-start
-- time: a hundred chunks written by one statement share it to the microsecond.
-- So "insertion order" was recoverable from neither column, and the tab would
-- have numbered slices in whatever order the planner returned them.
--
-- Nullable rather than `not null default 0`: a default would state a position
-- for every chunk written before this migration, and 0 for all of them is a
-- worse answer than "unknown". Reads order by `position nulls last, created_at,
-- id`, so a Document written before this keeps a stable arbitrary order and
-- one written after is in body order. A re-embed rewrites a Document's chunks
-- wholesale, so the fix reaches old rows the next time anything touches them.
--
-- Deliberately not backfilled from the body (`strpos(content in body)` would
-- be exact where a chunk is a verbatim slice): it is a full table scan with a
-- string search per row to improve an ordering nobody has yet seen, and the
-- chunker is free to normalise a slice, which would make the answer wrong
-- rather than missing.

alter table public.concept_chunks
  add column if not exists position integer;

-- The tab's read: one Document's chunks in order. `position` leads, and the
-- two tie-breakers below it are what an old Document still has.
create index if not exists concept_chunks_concept_position_idx
  on public.concept_chunks (concept_id, position, created_at, id);

comment on column public.concept_chunks.position is
  'Zero-based index of this chunk within its Document body. Null for chunks written before ciele-org#929.';
