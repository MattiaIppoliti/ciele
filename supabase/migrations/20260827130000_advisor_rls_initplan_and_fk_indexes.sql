-- Supabase advisor sweep: RLS initplan, FK covering indexes, duplicate
-- permissive SELECT policies, one mutable function search_path.
--
-- Same class of work as 0017_query_performance_hardening and
-- 20260711160000_advisor_hardening, re-run now that the Teammates effort
-- (#768 through #778) added twelve tables and their policies. Every item below
-- comes from the project's own Performance/Security advisors, and every one is
-- semantics-preserving: this changes how fast the rules evaluate, never who
-- can see or write what.
--
-- 1. auth_rls_initplan (15 policies, 6 tables). A bare auth.uid() in a policy
--    is re-evaluated for every row scanned; (select auth.uid()) is hoisted to
--    an InitPlan and evaluated once per query. Identical result, and the gap
--    widens with table size. The private.* helpers take a per-row column
--    argument so they cannot be hoisted the same way, and are left alone.
--
-- 2. unindexed_foreign_keys (26). Postgres does not index FK columns for you.
--    Without a covering index every ON DELETE of a parent row scans the child
--    table, and every join over the FK is a sequential scan. This is a
--    write-path fix as much as a read-path one, which is why it is worth doing
--    before these tables carry traffic rather than after.
--
-- 3. multiple_permissive_policies (4 tables). Each carried a `for all` write
--    policy beside a dedicated read policy, so SELECT matched two permissive
--    policies and Postgres evaluated and OR'd both. Splitting the write policy
--    into insert/update/delete leaves exactly one SELECT policy per table.
--    Safe only because each write predicate implies its read predicate, which
--    was checked against the function bodies rather than assumed:
--      - has_assistant_role(id, 2) implies has_assistant_role(id, 1);
--      - can_create_org_knowledge(org) requires has_org_role(org, 2) or an
--        assistant grant inside that org, and both paths require membership of
--        it, so it implies is_org_member(org);
--      - can_write_source(s) requires rank 2 on *every* linked assistant (and
--        the CASE guarantees at least one link), so it implies the read side's
--        "rank 1 on at least one link"; with no links both sides fall through
--        to the org predicates above.
--    An editor therefore still reads every row it could read before, through
--    the read policy.
--
-- 4. function_search_path_mutable. public.assistant_access_rank is a pure
--    enum-to-int mapping with no object references, so an empty search_path
--    costs it nothing and removes the injection surface.
--
-- Deliberately NOT done here, with reasons:
--   - unused_index (48 lints). "Unused" here means "this project has served
--     almost no traffic yet", not "no query needs it": most of them back RLS
--     predicates and FK cascades the advisors themselves ask for. Dropping
--     indexes on an unearned statistic is how a later migration ends up
--     re-adding them.
--   - extension_in_public (vector). Moving pgvector moves every vector column,
--     index and operator reference with it. That is a migration of its own,
--     with a real chance of breaking retrieval, not a line in a sweep.
--   - authenticated_security_definer_function_executable (accept_invite,
--     create_organization, next_improvement_seq). Intentional: these are the
--     RPCs the app calls as a signed-in user, each checks auth.uid() inside
--     its own body, and 0018 already revoked anon and PUBLIC from all three.
--   - rls_enabled_no_policy (11 tables). Also intentional: RLS on with no
--     policy is deny-all for anon and authenticated, the correct posture for
--     tables only the service role touches.
--   - Leaked-password protection is an Auth dashboard setting, not schema.

-- Plain CREATE INDEX, not CONCURRENTLY, on purpose: the applier runs each
-- migration inside one transaction (so a failure leaves no ledger row) and
-- CONCURRENTLY cannot run in a transaction. These 26 tables are small to empty,
-- so the brief SHARE lock costs milliseconds. A future index on a large table
-- needs its own migration and its own answer to that trade-off.

-- 1. FK covering indexes ---------------------------------------------------

create index if not exists assistant_access_granted_by_idx
  on public.assistant_access (granted_by);
create index if not exists improvement_proposals_organization_id_idx
  on public.improvement_proposals (organization_id);
create index if not exists improvements_project_id_idx
  on public.improvements (project_id);
create index if not exists local_connector_devices_user_id_idx
  on public.local_connector_devices (user_id);
create index if not exists local_connector_pairings_organization_id_idx
  on public.local_connector_pairings (organization_id);
create index if not exists local_connector_pairings_user_id_idx
  on public.local_connector_pairings (user_id);
create index if not exists local_inference_jobs_organization_id_idx
  on public.local_inference_jobs (organization_id);
create index if not exists local_inference_jobs_user_id_idx
  on public.local_inference_jobs (user_id);
create index if not exists memories_conversation_id_idx
  on public.memories (conversation_id);
create index if not exists memory_document_entries_author_id_idx
  on public.memory_document_entries (author_id);
create index if not exists memory_document_entries_organization_id_idx
  on public.memory_document_entries (organization_id);
create index if not exists memory_document_entries_teammate_id_idx
  on public.memory_document_entries (teammate_id);
create index if not exists memory_documents_member_id_idx
  on public.memory_documents (member_id);
create index if not exists organization_api_keys_created_by_idx
  on public.organization_api_keys (created_by);
create index if not exists projects_created_by_idx
  on public.projects (created_by);
create index if not exists teammate_channel_messages_author_teammate_id_idx
  on public.teammate_channel_messages (author_teammate_id);
create index if not exists teammate_channel_messages_author_user_id_idx
  on public.teammate_channel_messages (author_user_id);
create index if not exists teammate_channel_messages_organization_id_idx
  on public.teammate_channel_messages (organization_id);
create index if not exists teammate_channel_participants_added_by_idx
  on public.teammate_channel_participants (added_by);
create index if not exists teammate_channel_participants_organization_id_idx
  on public.teammate_channel_participants (organization_id);
create index if not exists teammate_channel_participants_teammate_id_idx
  on public.teammate_channel_participants (teammate_id);
create index if not exists teammate_channels_created_by_idx
  on public.teammate_channels (created_by);
create index if not exists teammate_grants_granted_by_idx
  on public.teammate_grants (granted_by);
create index if not exists teammate_roster_hidden_organization_id_idx
  on public.teammate_roster_hidden (organization_id);
create index if not exists teammate_routines_created_by_idx
  on public.teammate_routines (created_by);
create index if not exists teammate_routines_organization_id_idx
  on public.teammate_routines (organization_id);

-- 2. RLS initplan: hoist auth.uid() ---------------------------------------

drop policy if exists "read profiles of shared orgs" on public.profiles;
create policy "read profiles of shared orgs" on public.profiles
  for select using (
    id = (select auth.uid())
    or private.is_platform_superuser()
    or exists (
      select 1
      from public.organization_members mine
      join public.organization_members theirs
        on mine.organization_id = theirs.organization_id
      where mine.user_id = (select auth.uid())
        and theirs.user_id = profiles.id
    )
  );

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles
  for update using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "members read their own memory document" on public.memory_documents;
create policy "members read their own memory document" on public.memory_documents
  for select using (
    (member_id is not null and member_id = (select auth.uid()))
    or (member_id is null and private.is_org_member(organization_id))
  );

drop policy if exists "members write their own memory document" on public.memory_documents;
create policy "members write their own memory document" on public.memory_documents
  for insert with check (
    (member_id is not null and member_id = (select auth.uid()))
    or (member_id is null and private.has_org_role(organization_id, 2))
  );

-- No `with check` on purpose. Omitted, Postgres reuses `using` for the new
-- row, which is exactly what this policy did before.
drop policy if exists "members update their own memory document" on public.memory_documents;
create policy "members update their own memory document" on public.memory_documents
  for update using (
    (member_id is not null and member_id = (select auth.uid()))
    or (member_id is null and private.has_org_role(organization_id, 2))
  );

drop policy if exists "members delete their own memory document" on public.memory_documents;
create policy "members delete their own memory document" on public.memory_documents
  for delete using (
    (member_id is not null and member_id = (select auth.uid()))
    or (member_id is null and private.has_org_role(organization_id, 2))
  );

drop policy if exists "readers read memory history" on public.memory_document_entries;
create policy "readers read memory history" on public.memory_document_entries
  for select using (
    exists (
      select 1 from public.memory_documents d
      where d.id = memory_document_entries.document_id
        and (
          (d.member_id is not null and d.member_id = (select auth.uid()))
          or (d.member_id is null and private.is_org_member(d.organization_id))
        )
    )
  );

drop policy if exists "writers append memory history" on public.memory_document_entries;
create policy "writers append memory history" on public.memory_document_entries
  for insert with check (
    exists (
      select 1 from public.memory_documents d
      where d.id = memory_document_entries.document_id
        and (
          (d.member_id is not null and d.member_id = (select auth.uid()))
          or (d.member_id is null and private.has_org_role(d.organization_id, 2))
        )
    )
  );

drop policy if exists "members read their own hidden teammates" on public.teammate_roster_hidden;
create policy "members read their own hidden teammates" on public.teammate_roster_hidden
  for select using (
    user_id = (select auth.uid()) and private.is_org_member(organization_id)
  );

drop policy if exists "members hide a teammate for themselves" on public.teammate_roster_hidden;
create policy "members hide a teammate for themselves" on public.teammate_roster_hidden
  for insert with check (
    user_id = (select auth.uid()) and private.is_org_member(organization_id)
  );

drop policy if exists "members unhide a teammate for themselves" on public.teammate_roster_hidden;
create policy "members unhide a teammate for themselves" on public.teammate_roster_hidden
  for delete using (
    user_id = (select auth.uid()) and private.is_org_member(organization_id)
  );

drop policy if exists "the creator or an admin deletes channels" on public.teammate_channels;
create policy "the creator or an admin deletes channels" on public.teammate_channels
  for delete using (
    created_by = (select auth.uid()) or private.has_org_role(organization_id, 3)
  );

drop policy if exists "channel members add to the roster" on public.teammate_channel_participants;
create policy "channel members add to the roster" on public.teammate_channel_participants
  for insert with check (
    (
      private.is_channel_member(channel_id)
      or exists (
        select 1 from public.teammate_channels c
        where c.id = teammate_channel_participants.channel_id
          and c.created_by = (select auth.uid())
      )
      or private.has_org_role(organization_id, 3)
    )
    and (
      teammate_id is null
      or exists (
        select 1 from public.teammates t
        where t.id = teammate_channel_participants.teammate_id
          and t.organization_id = teammate_channel_participants.organization_id
          and t.deleted_at is null
          and (
            t.visibility = 'org'
            or t.owner_id = (select auth.uid())
            or t.editor_ids @> to_jsonb(((select auth.uid()))::text)
          )
      )
    )
  );

drop policy if exists "members update their own read marker" on public.teammate_channel_participants;
create policy "members update their own read marker" on public.teammate_channel_participants
  for update using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid()) and private.is_channel_member(channel_id)
  );

drop policy if exists "the creator, an admin, or you leaving" on public.teammate_channel_participants;
create policy "the creator, an admin, or you leaving" on public.teammate_channel_participants
  for delete using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.teammate_channels c
      where c.id = teammate_channel_participants.channel_id
        and c.created_by = (select auth.uid())
    )
    or private.has_org_role(organization_id, 3)
  );

-- 3. One SELECT policy per table ------------------------------------------

drop policy if exists "editors write assistant sources" on public.assistant_sources;
create policy "editors insert assistant sources" on public.assistant_sources
  for insert with check (
    private.has_assistant_role(assistant_id, 2)
    and exists (
      select 1 from public.assistants a
      where a.id = assistant_sources.assistant_id
        and a.organization_id = private.source_org(assistant_sources.source_id)
    )
  );
create policy "editors update assistant sources" on public.assistant_sources
  for update using (private.has_assistant_role(assistant_id, 2))
  with check (
    private.has_assistant_role(assistant_id, 2)
    and exists (
      select 1 from public.assistants a
      where a.id = assistant_sources.assistant_id
        and a.organization_id = private.source_org(assistant_sources.source_id)
    )
  );
create policy "editors delete assistant sources" on public.assistant_sources
  for delete using (private.has_assistant_role(assistant_id, 2));

drop policy if exists "editors write org collections" on public.knowledge_collections;
create policy "editors insert org collections" on public.knowledge_collections
  for insert with check (private.can_create_org_knowledge(organization_id));
create policy "editors update org collections" on public.knowledge_collections
  for update using (private.can_create_org_knowledge(organization_id))
  with check (private.can_create_org_knowledge(organization_id));
create policy "editors delete org collections" on public.knowledge_collections
  for delete using (private.can_create_org_knowledge(organization_id));

drop policy if exists "editors write org concepts" on public.concepts;
create policy "editors insert org concepts" on public.concepts
  for insert with check (
    exists (
      select 1 from public.knowledge_collections kc
      where kc.id = concepts.collection_id
        and private.can_create_org_knowledge(kc.organization_id)
    )
  );
create policy "editors update org concepts" on public.concepts
  for update using (
    case
      when source_id is not null then private.can_write_source(source_id)
      else exists (
        select 1 from public.knowledge_collections kc
        where kc.id = concepts.collection_id
          and private.can_create_org_knowledge(kc.organization_id)
      )
    end
  )
  with check (
    exists (
      select 1 from public.knowledge_collections kc
      where kc.id = concepts.collection_id
        and private.can_create_org_knowledge(kc.organization_id)
    )
  );
create policy "editors delete org concepts" on public.concepts
  for delete using (
    case
      when source_id is not null then private.can_write_source(source_id)
      else exists (
        select 1 from public.knowledge_collections kc
        where kc.id = concepts.collection_id
          and private.can_create_org_knowledge(kc.organization_id)
      )
    end
  );

drop policy if exists "editors write org chunks" on public.concept_chunks;
create policy "editors insert org chunks" on public.concept_chunks
  for insert with check (
    exists (
      select 1 from public.knowledge_collections kc
      where kc.id = concept_chunks.collection_id
        and private.can_create_org_knowledge(kc.organization_id)
    )
  );
create policy "editors update org chunks" on public.concept_chunks
  for update using (
    case
      when source_id is not null then private.can_write_source(source_id)
      else exists (
        select 1 from public.knowledge_collections kc
        where kc.id = concept_chunks.collection_id
          and private.can_create_org_knowledge(kc.organization_id)
      )
    end
  )
  with check (
    exists (
      select 1 from public.knowledge_collections kc
      where kc.id = concept_chunks.collection_id
        and private.can_create_org_knowledge(kc.organization_id)
    )
  );
create policy "editors delete org chunks" on public.concept_chunks
  for delete using (
    case
      when source_id is not null then private.can_write_source(source_id)
      else exists (
        select 1 from public.knowledge_collections kc
        where kc.id = concept_chunks.collection_id
          and private.can_create_org_knowledge(kc.organization_id)
      )
    end
  );

-- 4. Pin the one mutable search_path --------------------------------------

alter function public.assistant_access_rank(public.assistant_access_role)
  set search_path = '';
