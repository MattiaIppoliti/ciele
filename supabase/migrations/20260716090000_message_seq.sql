-- Deterministic transcript ordering. messages.id is a random shortId and
-- created_at is stamped by now(), so two messages appended in the same
-- clock tick (a user turn + the assistant reply written back-to-back) have
-- no defined order, `order by created_at` returns them in arbitrary
-- sequence, which can flip a question/answer pair in the transcript and in
-- the runtime's context window. Found by the Db contract suite running the
-- Supabase adapter over PGlite (ADR-0016 stage 2).
--
-- seq is an insertion-ordered tiebreak, never exposed in the domain model:
-- readers order by (created_at, seq). Identity backfill for existing rows
-- follows physical scan order, which is why created_at stays the primary
-- sort key and seq only breaks its ties.
alter table public.messages
  add column if not exists seq bigint generated always as identity;

create index if not exists messages_conversation_seq_idx
  on public.messages (conversation_id, created_at, seq);
