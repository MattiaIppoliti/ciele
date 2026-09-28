-- Guardrails: per-Assistant checks around every Visitor turn, an ordered list
-- the Guardrails SETUP section edits (packages/core/src/guardrails.ts owns the
-- shape and its validation). Four types read the Visitor's message before any
-- Flow routes it; one rewrites the answer while it streams.
--
-- One jsonb column, like `tools` and `style`: the list is editor-authored
-- configuration that travels whole into a Publication snapshot, and a row per
-- guardrail would buy nothing a turn reads.
--
-- Defaults to an empty list: an existing Assistant keeps answering exactly as
-- it did.
alter table public.assistants
  add column guardrails jsonb not null default '[]'::jsonb;

alter table public.assistants
  add constraint assistants_guardrails_is_array
  check (jsonb_typeof(guardrails) = 'array');
