-- Three-layer memory documents + the Project entity
-- (spec ciele-org#767, ticket ciele-org#771).
--
-- Deliberately NOT the embedding-recall memory the widget uses for Visitors
-- (`memories`, #664). That one answers "what do I half-remember about this
-- person"; these are three markdown documents injected whole into the prompt,
-- like `answering_style`, because a colleague's profile, an agent's standing
-- learnings and a project's decisions are things you read in full or not at
-- all. Retrieving the top-k sentences of your own team's conventions would be
-- worse than useless.

-- A Project: the durable home for decisions that belong to the work ----------
--
-- Lightweight on purpose (#767 out-of-scope: no Improvements per Project, no
-- conversations per Project, no many-to-many). It exists so "what did we
-- already decide" has an answer that outlives the conversation it was decided
-- in. Its document lives in `memory_documents` below, with the other two.

create table public.projects (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  description text not null default '',
  -- Archived, not deleted: the decisions stay readable, and an attached
  -- Teammate stops injecting them.
  archived boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_org_idx on public.projects (organization_id, created_at);

alter table public.projects enable row level security;

create policy "members read projects" on public.projects
  for select using (private.is_org_member(organization_id));
create policy "editors create projects" on public.projects
  for insert with check (private.has_org_role(organization_id, 2));
create policy "editors update projects" on public.projects
  for update using (private.has_org_role(organization_id, 2));
create policy "editors delete projects" on public.projects
  for delete using (private.has_org_role(organization_id, 2));

-- A Teammate attaches to at most one Project (#767, story 23). Nullable and
-- `set null`, so deleting a Project detaches its Teammates rather than taking
-- them with it.
alter table public.teammates
  add column project_id text references public.projects (id) on delete set null;

create index teammates_project_idx on public.teammates (project_id);

-- The documents ---------------------------------------------------------------
--
-- One table for all three layers, because they are one mechanism: a body, a
-- size cap, a write tool and a history. What differs is only who owns the row,
-- so ownership is three nullable columns under an exclusive-or check, the
-- same shape `conversations` took for Assistant-or-Teammate (#768). The check
-- is the discriminator, and unlike a `scope` column beside the ids it cannot
-- disagree with them.

create table public.memory_documents (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- User layer: one per Member, shared across every Teammate they talk to.
  member_id uuid references auth.users (id) on delete cascade,
  -- Agent layer: one per Teammate, its distilled learnings.
  teammate_id text references public.teammates (id) on delete cascade,
  -- Project layer: one per Project, its conventions and decisions.
  project_id text references public.projects (id) on delete cascade,
  constraint memory_documents_one_owner
    check (num_nonnulls(member_id, teammate_id, project_id) = 1),
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One document per owner. Partial uniques rather than one composite, because
-- two of the three columns are always null and a composite unique would let
-- (org, null, null, project-a) and (org, null, null, project-a) coexist in
-- some engines' null semantics.
create unique index memory_documents_member_uniq
  on public.memory_documents (organization_id, member_id) where member_id is not null;
create unique index memory_documents_teammate_uniq
  on public.memory_documents (teammate_id) where teammate_id is not null;
create unique index memory_documents_project_uniq
  on public.memory_documents (project_id) where project_id is not null;

alter table public.memory_documents enable row level security;

-- The User layer is the Member's own, and only theirs. Not an admin's, not
-- their manager's: story 19 makes the Member sovereign over what the platform
-- remembers about them, and a policy that let anyone else read it would make
-- that sentence false. The Agent and Project layers are team documents, read
-- by the org and written by Editor and up.
create policy "members read their own memory document" on public.memory_documents
  for select using (
    (member_id is not null and member_id = auth.uid())
    or (member_id is null and private.is_org_member(organization_id))
  );
create policy "members write their own memory document" on public.memory_documents
  for insert with check (
    (member_id is not null and member_id = auth.uid())
    or (member_id is null and private.has_org_role(organization_id, 2))
  );
create policy "members update their own memory document" on public.memory_documents
  for update using (
    (member_id is not null and member_id = auth.uid())
    or (member_id is null and private.has_org_role(organization_id, 2))
  );
create policy "members delete their own memory document" on public.memory_documents
  for delete using (
    (member_id is not null and member_id = auth.uid())
    or (member_id is null and private.has_org_role(organization_id, 2))
  );

-- The history -----------------------------------------------------------------
--
-- Append-only. Each row is one write, and it keeps the body as it was *before*
-- that write, which is what makes "revert this entry" a restore rather than a
-- reconstruction. Storing the before-image rather than a diff costs a copy of a
-- capped document and buys an undo that cannot be wrong.

create table public.memory_document_entries (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  document_id text not null references public.memory_documents (id) on delete cascade,
  -- The Teammate that wrote it, when a Teammate wrote it. Null for a Member
  -- editing their own document in settings.
  teammate_id text references public.teammates (id) on delete set null,
  -- The Member the write is attributed to: the one editing, or the one whose
  -- turn the Teammate was answering. Never null in practice, nullable so the
  -- history outlives the account (#767, story 19: who/when/what).
  author_id uuid references auth.users (id) on delete set null,
  -- What the writer said it was doing, in its own words.
  note text not null default '',
  body_before text not null default '',
  created_at timestamptz not null default now()
);

create index memory_document_entries_document_idx
  on public.memory_document_entries (document_id, created_at desc);

alter table public.memory_document_entries enable row level security;

-- History follows its document: if you may read the document you may read how
-- it got that way. Inserts ride the same rule; nothing ever updates or deletes
-- a row here, which is what makes it evidence rather than a changelog.
create policy "readers read memory history" on public.memory_document_entries
  for select using (exists (
    select 1 from public.memory_documents d
    where d.id = memory_document_entries.document_id
      and (
        (d.member_id is not null and d.member_id = auth.uid())
        or (d.member_id is null and private.is_org_member(d.organization_id))
      )
  ));
create policy "writers append memory history" on public.memory_document_entries
  for insert with check (exists (
    select 1 from public.memory_documents d
    where d.id = memory_document_entries.document_id
      and (
        (d.member_id is not null and d.member_id = auth.uid())
        or (d.member_id is null and private.has_org_role(d.organization_id, 2))
      )
  ));

-- One more metered stage ------------------------------------------------------
--
-- `agent_memory`: the end-of-turn distillation that writes the Agent layer.
-- The constraint has to grow with the `AiUsageStage` union or the rows are
-- dropped in production (`meterUsage` isolates the failure), which is how
-- improvement_proposal rows went missing before 20260720100000. The contract
-- suite's `Record<AiUsageStage, true>` guard is what forces this edit.

alter table public.ai_usage
  drop constraint if exists ai_usage_stage_check;

alter table public.ai_usage
  add constraint ai_usage_stage_check
  check (stage in (
    'classify',
    'generate',
    'embed',
    'enrich',
    'verify',
    'goal_eval',
    'compost',
    'improvement_proposal',
    'graph_search',
    'graph_cognify',
    'memory_extract',
    'agent_memory'
  ));
