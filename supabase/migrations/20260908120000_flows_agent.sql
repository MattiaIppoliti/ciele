-- Flows Agent (spec #836, ticket #838).
--
-- A system AI Teammate, one per Assistant, that builds and edits Flows with the
-- Editor from the Flow Canvas. It is an ordinary Teammate row (same runtime,
-- same conversations, same grants) with two facts the roster and the referral
-- picker use to keep it out of the way: which kind of system Teammate it is,
-- and which Assistant it belongs to. Its tools live under a new `flows` grant
-- domain, so the check constraint on `teammate_grants` learns the word.

alter table public.teammates
  add column system_kind text check (system_kind in ('flows_agent')),
  add column assistant_id text references public.assistants (id) on delete cascade;

comment on column public.teammates.system_kind is
  'Null for a Member-created Teammate. flows_agent: the system Teammate the Flow Canvas chats with (#838).';
comment on column public.teammates.assistant_id is
  'The Assistant a system Teammate belongs to; null for a Member-created one.';

-- The FK's covering index (an Assistant delete cascades through it).
create index teammates_assistant_id_idx
  on public.teammates (assistant_id)
  where assistant_id is not null;

-- One system Teammate of each kind per Assistant.
create unique index teammates_system_assistant_uidx
  on public.teammates (organization_id, assistant_id, system_kind)
  where system_kind is not null;

alter table public.teammate_grants
  drop constraint teammate_grants_domain_check;
alter table public.teammate_grants
  add constraint teammate_grants_domain_check
  check (domain in ('improvements', 'knowledge', 'inbox', 'flows'));
