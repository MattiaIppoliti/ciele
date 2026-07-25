-- Inbox: best-effort session context captured when a conversation starts
-- (user info, launch URL, IP, OS, browser, language, location, escalation).
alter table public.conversations
  add column if not exists metadata jsonb not null default '{}'::jsonb;
