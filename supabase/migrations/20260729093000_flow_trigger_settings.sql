-- Trigger-scoped Flow configuration: settings that belong to the *event* that
-- starts a flow rather than to one of its actions. Today that is the "Time on
-- page" dwell duration ({ timeOnPage: { minutes, seconds } }); per-action config
-- keeps living in action_settings.
--
-- Defaults to an empty object, so every existing flow reads as "no
-- trigger-specific configuration" without a backfill.
alter table public.flows
  add column if not exists trigger_settings jsonb not null default '{}';
