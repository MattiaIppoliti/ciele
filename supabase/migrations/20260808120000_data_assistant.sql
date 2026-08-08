-- Org-staff data assistant (#668): which Entities the data assistant may
-- query is an org-level selection, deliberately separate from any
-- customer-facing assistant's per-assistant selection.
alter table public.organizations
  add column data_assistant_entities jsonb not null default '[]'::jsonb;
