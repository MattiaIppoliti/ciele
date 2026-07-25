-- Backfill: this was applied directly to the live project
-- on 2026-07-05 without ever being captured as a local migration file. Added
-- here so a fresh environment built from this repo matches production.
alter table public.assistants
  add column if not exists answering_style text not null default '';

create table public.platform_settings (
  id text primary key default 'default' check (id = 'default'),
  system_prompt text not null default '',
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.platform_settings enable row level security;

insert into public.platform_settings (id) values ('default')
on conflict (id) do nothing;
