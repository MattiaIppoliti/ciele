-- Quick-reply starter buttons: typed buttons shown under the welcome message
-- (Send Text Into Chat / Escalation / Open External Link / FAQ). Stored as a
-- JSON array of { id, label, type, text?, url? } objects, max 50 in the UI.
alter table public.assistants
  add column quick_replies jsonb not null default '[]'::jsonb;
