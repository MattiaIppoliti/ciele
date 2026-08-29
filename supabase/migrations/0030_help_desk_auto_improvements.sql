-- Help desk "Answer Improvements": when enabled, escalating a conversation
-- through this desk auto-generates an Improvement from the last AI answer.
alter table public.help_desks
  add column auto_generate_improvements boolean not null default false;
