-- Why a chat turn ended, stated once by the runtime that ended it
-- (`TurnOutcome` in packages/core). Readers switch on this instead of
-- re-deriving the reason from reply parts, trace steps and error classes.
--
-- Free text without a check constraint, like provider and model_id: a new
-- outcome must never be refused by a database one migration behind the code.
-- Null on every kind other than chat_turn, and on chat_turn rows written
-- before this column existed.

alter table public.runtime_events
  add column if not exists outcome text;
