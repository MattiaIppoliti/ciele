-- Basic Interaction (#565): the built-in Flow that answers conversational
-- courtesy, a greeting, a thanks, a farewell, with one model call and no
-- retrieval. New Assistants get it from DEFAULT_FLOWS; this backfills the ones
-- that already exist.
--
-- Two deliberate choices:
--
--  * Position is `min(position) - 1`, not 0. Inserting below the current minimum
--    puts the Flow first in priority without UPDATEing a single existing row, so
--    every admin's configured relative order survives untouched.
--
--  * The guard is structural: "no built-in Flow of this Assistant already
--    carries the basic_reply action", matching how the runtime identifies the
--    Flow. An Assistant whose Basic Interaction Flow was renamed is correctly
--    skipped; the deterministic id keeps a re-run a no-op either way.

insert into public.flows (
  id, assistant_id, name, description,
  built_in, enabled, position, actions, custom_message, is_default
)
select
  substr(md5(a.id || 'Basic Interaction'), 1, 12),
  a.id,
  'Basic Interaction',
  'User is greeting the assistant, thanking it, saying goodbye, or acknowledging a previous answer, conversational courtesy that asks no question and carries no information need',
  true,
  true,
  coalesce(
    (select min(f.position) from public.flows f where f.assistant_id = a.id),
    1
  ) - 1,
  array['basic_reply'],
  '',
  false
from public.assistants a
where not exists (
  select 1
  from public.flows f
  where f.assistant_id = a.id
    and f.built_in
    and 'basic_reply' = any(f.actions)
)
on conflict (id) do nothing;
