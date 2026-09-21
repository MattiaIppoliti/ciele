-- The models a chat window may switch between, per Assistant and per Teammate.
--
-- Both entities already carry one model as two scalar columns (`model_provider`
-- + `model_id`), decided once by an admin. That stays the model a turn runs.
-- This adds the *other* models the asker may pick instead, as an ordered list of
-- `{"provider": …, "modelId": …}` objects.
--
-- Empty is the default and means no picker at all. That matters more than it
-- looks: without it, every Assistant already published would start offering
-- every model its Organization holds a credential for, to anonymous Visitors on
-- someone else's page, because nobody chose to. An org opens this deliberately
-- or not at all.
--
-- jsonb rather than a join table for the same reason `collection_ids` and
-- `source_ids` are jsonb: an empty list is a valid configuration, the order is
-- the admin's and worth keeping, and a model id is a catalogue string rather
-- than a row anyone can reference. A provider whose connection is later removed
-- simply stops resolving, and the read-time filter drops it from the list; there
-- is nothing to cascade.
--
-- No check constraint on the shape. The runtime resolves every entry against the
-- catalogue and the Organization's Provider Connections before it runs anything
-- (`resolveRequestedModel` in @agent-hub/core), so a row that goes stale costs a
-- Visitor nothing, where a constraint that disagreed with the catalogue would
-- cost them the whole conversation.

alter table public.assistants
  add column if not exists allowed_models jsonb not null default '[]'::jsonb;

alter table public.teammates
  add column if not exists allowed_models jsonb not null default '[]'::jsonb;
