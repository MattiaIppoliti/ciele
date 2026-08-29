-- AI Disclaimer: short text shown under AI responses at the bottom of the chat
-- window (editor preview + published widget). Nullable; the app coalesces a
-- null/absent value to the default disclaimer, and an empty string hides it.
alter table public.assistants
  add column ai_disclaimer text;

update public.assistants
  set ai_disclaimer =
    'AI answers are not perfect, so please double-check any critical information.'
  where ai_disclaimer is null;
