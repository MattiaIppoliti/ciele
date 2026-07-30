-- Simplified thinking (#560): a per-Assistant toggle. With it on, every tool
-- phase of a turn narrates itself to the Visitor in one short line, in their
-- language, and that narration is persisted with the answer as its own reply
-- part — so the Inbox transcript shows what the Visitor actually watched happen.
--
-- Defaults off: turning it on changes what a Visitor sees, so an existing
-- assistant keeps behaving exactly as it did.
alter table public.assistants
  add column simplified_thinking boolean not null default false;
