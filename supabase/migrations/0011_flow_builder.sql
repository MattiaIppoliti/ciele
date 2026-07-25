-- Flow builder: triggers, conditions with examples, per-action settings.
alter table public.flows
  add column if not exists trigger_kind text not null default 'message',
  add column if not exists condition_logic text not null default 'any',
  add column if not exists conditions jsonb not null default '[]',
  add column if not exists action_settings jsonb not null default '{}';
