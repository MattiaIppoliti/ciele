-- Payload for the custom_message flow action.
alter table public.flows
  add column if not exists custom_message text not null default '';
