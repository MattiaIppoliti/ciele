-- System prompts, two layers (see docs/agentic-chat-runtime.md):
--
-- 1. `assistants.answering_style` — the org-authored system prompt for one
--    assistant (the reference platform's "Answering style", ≤10000 chars,
--    enforced in the UI). Layered UNDER the platform prompt at runtime.
-- 2. `platform_settings.system_prompt` — the platform-wide (Ciele) system
--    prompt. Single row, editable only by the platform owner through a
--    service-role path; organizations can neither read nor change it.

alter table public.assistants
  add column if not exists answering_style text not null default '';

create table public.platform_settings (
  -- Single-row table; the fixed id makes upserts trivial.
  id text primary key default 'default' check (id = 'default'),
  system_prompt text not null default '',
  -- Email of the platform owner who last edited the prompt.
  updated_by text,
  updated_at timestamptz not null default now()
);

-- RLS with no policies: only the service-role client (which bypasses RLS)
-- can read or write. Org members have no access, by design.
alter table public.platform_settings enable row level security;

insert into public.platform_settings (id) values ('default')
on conflict (id) do nothing;
