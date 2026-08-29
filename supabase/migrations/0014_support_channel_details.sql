-- Support channels: Conversation Data toggles + Availability schedule.

alter table public.support_channels
  add column if not exists conversation_data jsonb not null default '{}',
  add column if not exists availability jsonb not null default '{}';
