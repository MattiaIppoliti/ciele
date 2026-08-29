-- AI Teammates: the entity, the Conversation it owns, and the retrieval scope
-- (spec ciele-org#767, ticket ciele-org#768).
--
-- A Teammate is the Assistant's internal sibling: same chat runtime, same
-- knowledge, same citations, but it answers Members inside the console instead
-- of Visitors on a website. So it has no Publication, no Flows, no widget and
-- no allowed-domains list; what it does have is a persona, a Knowledge Scope,
-- an owner and a visibility.

create table public.teammates (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- The Member who created it. Keeps edit rights on a private Teammate; the
  -- row survives their account deletion so past Conversations stay readable.
  owner_id uuid references auth.users (id) on delete set null,
  name text not null,
  title text not null default '',
  -- The Standing Role: read at turn time and rendered into the persona prompt
  -- layer, which is why editing it needs no republish.
  role_description text not null default '',
  avatar_seed text not null default '',
  -- Members who may edit it besides the owner and the org's admins.
  editor_ids jsonb not null default '[]'::jsonb,
  visibility text not null default 'org' check (visibility in ('org', 'private')),
  -- Knowledge Scope: Library Collections this Teammate may search. Deliberately
  -- not a FK table: an empty scope is a valid configuration (pure persona), and
  -- a dangling id raises an Alert rather than deleting the Teammate's scope
  -- under it (ticket ciele-org#769).
  collection_ids jsonb not null default '[]'::jsonb,
  model_provider text not null default 'anthropic',
  model_id text not null default 'claude-opus-4-8',
  -- Soft delete: the tombstone hides it from every roster while its past
  -- Conversations stay readable.
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index teammates_org_idx on public.teammates (organization_id, created_at);
create index teammates_owner_idx on public.teammates (owner_id);

alter table public.teammates enable row level security;

-- Every Member of the org reads the rows; which of them appear on a given
-- Member's roster is the visibility rule, applied in the operations layer
-- (`canViewTeammate`), because a private Teammate is hidden from a colleague,
-- not from the database. Writes need Editor and up.
create policy "members read teammates" on public.teammates
  for select using (private.is_org_member(organization_id));
create policy "editors create teammates" on public.teammates
  for insert with check (private.has_org_role(organization_id, 2));
create policy "editors update teammates" on public.teammates
  for update using (private.has_org_role(organization_id, 2));
create policy "editors delete teammates" on public.teammates
  for delete using (private.has_org_role(organization_id, 2));

-- A Conversation now belongs to an Assistant OR to a Teammate ------------------
--
-- Two nullable owners with an exclusive-or check, rather than a `surface`
-- column beside them: the check is the discriminator, and it cannot disagree
-- with the columns the way a redundant label would.

alter table public.conversations
  alter column assistant_id drop not null;

alter table public.conversations
  add column teammate_id text references public.teammates (id) on delete cascade;

alter table public.conversations
  add constraint conversations_one_owner
  check (num_nonnulls(assistant_id, teammate_id) = 1);

create index conversations_teammate_subject_idx
  on public.conversations (teammate_id, subject_id, updated_at desc);

-- RLS: the existing policies reach the org through the Assistant, which a
-- Teammate Conversation does not have. Each grows a second branch instead of a
-- second policy, so "who may read a Conversation" stays one rule.
drop policy "members read own conversations" on public.conversations;
create policy "members read own conversations" on public.conversations
  for select using (
    exists (
      select 1 from public.assistants a
      where a.id = conversations.assistant_id
        and private.is_org_member(a.organization_id)
    )
    or exists (
      select 1 from public.teammates t
      where t.id = conversations.teammate_id
        and private.is_org_member(t.organization_id)
    )
  );

drop policy "members write own conversations" on public.conversations;
create policy "members write own conversations" on public.conversations
  for insert with check (
    exists (
      select 1 from public.assistants a
      where a.id = conversations.assistant_id
        and private.is_org_member(a.organization_id)
    )
    or exists (
      select 1 from public.teammates t
      where t.id = conversations.teammate_id
        and private.is_org_member(t.organization_id)
    )
  );

-- Messages hang off the Conversation, so they inherit the same two branches.
drop policy "members read messages" on public.messages;
create policy "members read messages" on public.messages
  for select using (exists (
    select 1 from public.conversations c
    left join public.assistants a on a.id = c.assistant_id
    left join public.teammates t on t.id = c.teammate_id
    where c.id = messages.conversation_id
      and (
        private.is_org_member(a.organization_id)
        or private.is_org_member(t.organization_id)
      )
  ));

drop policy "members write messages" on public.messages;
create policy "members write messages" on public.messages
  for insert with check (exists (
    select 1 from public.conversations c
    left join public.assistants a on a.id = c.assistant_id
    left join public.teammates t on t.id = c.teammate_id
    where c.id = messages.conversation_id
      and (
        private.is_org_member(a.organization_id)
        or private.is_org_member(t.organization_id)
      )
  ));

-- Telemetry: internal chat is its own surface, so a Teammate turn is not
-- counted as a Visitor's nor as an admin testing in the Preview.
alter table public.runtime_events
  drop constraint if exists runtime_events_surface_check;
alter table public.runtime_events
  add constraint runtime_events_surface_check
  check (surface is null or surface in ('preview', 'widget', 'teammate'));

-- Collection-scoped retrieval ------------------------------------------------
--
-- The Teammate half of `match_chunks_linked`: a Teammate has no Assistant, so
-- its scope is a set of Knowledge Collections rather than the assistant↔source
-- link table. Everything else (the excluded-Concept filter, cosine ordering,
-- the 1536-dim convention) is identical, so a citation looks the same whichever
-- search produced it.
create or replace function public.match_chunks_collections(
  p_collection_ids text[],
  p_query_embedding vector(1536),
  p_match_count int default 6
)
returns table (
  concept_id text,
  content text,
  similarity float
)
language sql stable as $$
  select
    cc.concept_id,
    cc.content,
    1 - (cc.embedding <=> p_query_embedding) as similarity
  from public.concept_chunks cc
  join public.concepts c on c.id = cc.concept_id
  where cc.embedding is not null
    and c.excluded = false
    and cc.collection_id = any(p_collection_ids)
  order by cc.embedding <=> p_query_embedding
  limit p_match_count
$$;

alter function public.match_chunks_collections(text[], vector, int)
  set search_path = public;
