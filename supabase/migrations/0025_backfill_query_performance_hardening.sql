-- Backfill: this was applied directly to the live project
-- on 2026-07-05 without ever being captured as a local migration file. Added
-- here so a fresh environment built from this repo matches production. Must
-- run BEFORE 0026_backfill_private_schema_hardening — it still calls
-- public.has_org_role(), which is correct for the schema state at the time
-- this actually ran live (before that function moved to `private`).
--
-- Query performance hardening, driven by the Supabase Performance Advisor:
-- fix RLS policies that re-evaluate auth.uid()
-- per row, add missing FK-covering indexes, and remove a duplicate
-- permissive SELECT policy. No behavior change — same access rules, cheaper
-- to evaluate as tables grow.

-- 1. auth_rls_initplan: a bare `auth.uid()` in a policy is re-checked for
--    every row scanned; `(select auth.uid())` lets Postgres evaluate it once
--    per query and reuse the cached result (InitPlan). Helper functions like
--    is_org_member()/has_org_role() take a per-row column argument so they
--    can't be hoisted the same way and are intentionally left as-is.

drop policy "admins remove members or self-leave" on public.organization_members;
create policy "admins remove members or self-leave" on public.organization_members
  for delete using (
    public.has_org_role(organization_id, 3) or user_id = (select auth.uid())
  );

drop policy "read profiles of shared orgs" on public.profiles;
create policy "read profiles of shared orgs" on public.profiles
  for select using (
    id = (select auth.uid())
    or exists (
      select 1
      from organization_members mine
      join organization_members theirs
        on mine.organization_id = theirs.organization_id
      where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id
    )
  );

drop policy "members update own conversations" on public.conversations;
create policy "members update own conversations" on public.conversations
  for update using (subject_type = 'member' and subject_id = (select auth.uid())::text);

drop policy "members delete own conversations" on public.conversations;
create policy "members delete own conversations" on public.conversations
  for delete using (subject_type = 'member' and subject_id = (select auth.uid())::text);

-- 2. unindexed_foreign_keys: every FK below is walked on ON DELETE CASCADE
--    and on normal lookups (e.g. "improvements assigned to me") without a
--    covering index today, forcing a sequential scan of the child table.

create index if not exists concept_chunks_collection_id_idx
  on public.concept_chunks (collection_id);
create index if not exists concept_chunks_concept_id_idx
  on public.concept_chunks (concept_id);
create index if not exists concepts_source_id_idx
  on public.concepts (source_id);
create index if not exists improvements_assignee_id_idx
  on public.improvements (assignee_id);
create index if not exists improvements_created_by_idx
  on public.improvements (created_by);
create index if not exists organization_invites_organization_id_idx
  on public.organization_invites (organization_id);
create index if not exists organization_invites_created_by_idx
  on public.organization_invites (created_by);
create index if not exists organization_invites_accepted_by_idx
  on public.organization_invites (accepted_by);
create index if not exists organization_members_user_id_idx
  on public.organization_members (user_id);
create index if not exists provider_connections_created_by_idx
  on public.provider_connections (created_by);
create index if not exists publications_created_by_idx
  on public.publications (created_by);

-- 3. multiple_permissive_policies: "members all collections" (FOR ALL) and
--    "members read collections" (FOR SELECT) are both permissive, so every
--    SELECT on knowledge_collections evaluated both policies and OR'd them.
--    Split the mutating policy into insert/update/delete so SELECT only
--    goes through the (cheaper, viewer-inclusive) read policy.

drop policy "members all collections" on public.knowledge_collections;

create policy "editors insert collections" on public.knowledge_collections
  for insert with check (exists (
    select 1 from public.assistants a
    where a.id = knowledge_collections.assistant_id
      and public.has_org_role(a.organization_id, 2)
  ));
create policy "editors update collections" on public.knowledge_collections
  for update using (exists (
    select 1 from public.assistants a
    where a.id = knowledge_collections.assistant_id
      and public.has_org_role(a.organization_id, 2)
  ));
create policy "editors delete collections" on public.knowledge_collections
  for delete using (exists (
    select 1 from public.assistants a
    where a.id = knowledge_collections.assistant_id
      and public.has_org_role(a.organization_id, 2)
  ));
