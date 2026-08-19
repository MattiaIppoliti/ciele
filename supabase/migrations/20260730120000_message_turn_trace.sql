-- Persisted turn trace (#557): the Thinking Steps that explain an answer.
--
-- One nullable jsonb column rather than a child table: a transcript reads every
-- message in one round-trip today, and a trace is only ever read with the
-- message it belongs to. Null means "no agentic work" (a verbatim message, a
-- proactive Notification) or "written before traces were persisted", the
-- transcript degrades to no panel either way.
--
-- The runtime caps and redacts the payload before it lands (see
-- packages/agent/src/trace.ts); nothing here enforces a size, because a clipped
-- trace must never be the reason a turn that already answered fails to save.

alter table public.messages
  add column if not exists trace jsonb;

comment on column public.messages.trace is
  'Thinking Steps for this answer: { steps, searchCount, truncated }. Capped and redacted by the runtime. Null for user messages and non-agentic turns.';
