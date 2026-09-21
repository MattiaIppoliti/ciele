-- The opening line a Skill writes into the composer when someone picks it from
-- the `/` menu.
--
-- A Skill already carries a `prompt`, and it is the wrong text for this. That
-- one is a system-prompt layer, addressed to the model and given to it every
-- turn; showing it in a Visitor's message box would put instructions written
-- *about* them in their own mouth. The starter is addressed to the reader who
-- is about to send it.
--
-- Empty, the default, keeps a Skill out of the `/` menu. That is the point of
-- the default rather than a shortcoming of it: every Skill that exists today
-- was written as a prompt layer and none of them has an opening line, so a
-- menu built on `prompt` would have shipped full of entries that insert the
-- wrong thing. An admin opts a Skill in by writing one.

alter table public.skills
  add column if not exists starter text not null default '';
