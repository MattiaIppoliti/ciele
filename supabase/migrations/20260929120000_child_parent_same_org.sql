-- A child row and the parent it points at must belong to the same Organization.
--
-- Each table below carries its own organization_id and a free foreign key to a
-- parent that has one too, and the write policies only ever checked the row's
-- own organization_id. PostgREST hands a Member's JWT straight to these tables,
-- so an Editor of org A could insert a row with organization_id = A that names
-- org B's assistant, teammate, or source. For an API integration that plants an
-- attacker-chosen base URL on a victim's assistant; for knowledge chunks it
-- puts attacker text into a victim's retrieval scope.
--
-- The fix is the same each time: the policy's WITH CHECK resolves the parent's
-- organization through a security-definer helper (the caller may not be able to
-- read the parent under RLS, and must not be able to probe it either) and
-- requires equality. assistant_api_integrations also gets a composite foreign
-- key, so the service role cannot write a mismatch by mistake.
--
-- Rows that already violate the rule are deleted first: no legitimate code path
-- writes one, and a row that crosses tenants is the thing being removed.

-- 1. Helpers ---------------------------------------------------------------

create or replace function private.assistant_org(p_assistant_id text)
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from public.assistants where id = p_assistant_id
$$;

create or replace function private.teammate_org(p_teammate_id text)
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from public.teammates where id = p_teammate_id
$$;

-- Does a chunk agree with the Concept it hangs off? Same Collection, same
-- Source (both may be null). Security definer so the answer does not depend on
-- what the writer can read under the Concepts policy.
create or replace function private.concept_scope_matches(
  p_concept_id text,
  p_collection_id text,
  p_source_id text
)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.concepts c
    where c.id = p_concept_id
      and c.collection_id = p_collection_id
      and c.source_id is not distinct from p_source_id
  )
$$;

revoke all on function private.assistant_org(text) from public;
revoke all on function private.teammate_org(text) from public;
revoke all on function private.concept_scope_matches(text, text, text) from public;
grant execute on function private.assistant_org(text) to authenticated, service_role;
grant execute on function private.teammate_org(text) to authenticated, service_role;
grant execute on function private.concept_scope_matches(text, text, text)
  to authenticated, service_role;

-- 2. Clear rows that already cross a tenant line ----------------------------

delete from public.assistant_api_integrations i
where i.organization_id is distinct from private.assistant_org(i.assistant_id);

delete from public.assistant_goals g
where g.organization_id is distinct from private.assistant_org(g.assistant_id);

delete from public.teammate_grants g
where g.organization_id is distinct from private.teammate_org(g.teammate_id);

delete from public.teammate_routines r
where r.organization_id is distinct from private.teammate_org(r.teammate_id);

delete from public.concepts c
using public.knowledge_collections kc
where kc.id = c.collection_id
  and c.source_id is not null
  and private.source_org(c.source_id) is distinct from kc.organization_id;

delete from public.concept_chunks cc
using public.knowledge_collections kc
where kc.id = cc.collection_id
  and cc.source_id is not null
  and private.source_org(cc.source_id) is distinct from kc.organization_id;

delete from public.concept_chunks cc
using public.concepts c, public.knowledge_collections ckc, public.knowledge_collections kc
where c.id = cc.concept_id
  and ckc.id = c.collection_id
  and kc.id = cc.collection_id
  and ckc.organization_id is distinct from kc.organization_id;

-- 3. assistant_api_integrations: composite key + policies -------------------

alter table public.assistants
  add constraint assistants_id_organization_id_key unique (id, organization_id);

alter table public.assistant_api_integrations
  add constraint assistant_api_integrations_assistant_org_fkey
  foreign key (assistant_id, organization_id)
  references public.assistants (id, organization_id) on delete cascade;

drop policy "editors create api integrations" on public.assistant_api_integrations;
create policy "editors create api integrations" on public.assistant_api_integrations
  for insert with check (
    private.has_org_role(organization_id, 2)
    and private.assistant_org(assistant_id) = organization_id
  );

drop policy "editors update api integrations" on public.assistant_api_integrations;
create policy "editors update api integrations" on public.assistant_api_integrations
  for update using (private.has_org_role(organization_id, 2))
  with check (
    private.has_org_role(organization_id, 2)
    and private.assistant_org(assistant_id) = organization_id
  );

-- 4. assistant_goals ---------------------------------------------------------

drop policy "editors create goals" on public.assistant_goals;
create policy "editors create goals" on public.assistant_goals
  for insert with check (
    private.has_org_role(organization_id, 2)
    and private.assistant_org(assistant_id) = organization_id
  );

drop policy "editors update goals" on public.assistant_goals;
create policy "editors update goals" on public.assistant_goals
  for update using (private.has_org_role(organization_id, 2))
  with check (
    private.has_org_role(organization_id, 2)
    and private.assistant_org(assistant_id) = organization_id
  );

-- 5. teammate_grants and teammate_routines -----------------------------------

drop policy "admins create teammate grants" on public.teammate_grants;
create policy "admins create teammate grants" on public.teammate_grants
  for insert with check (
    private.has_org_role(organization_id, 3)
    and private.teammate_org(teammate_id) = organization_id
  );

drop policy "admins update teammate grants" on public.teammate_grants;
create policy "admins update teammate grants" on public.teammate_grants
  for update using (private.has_org_role(organization_id, 3))
  with check (
    private.has_org_role(organization_id, 3)
    and private.teammate_org(teammate_id) = organization_id
  );

drop policy "editors create routines" on public.teammate_routines;
create policy "editors create routines" on public.teammate_routines
  for insert with check (
    private.has_org_role(organization_id, 2)
    and private.teammate_org(teammate_id) = organization_id
  );

drop policy "editors update routines" on public.teammate_routines;
create policy "editors update routines" on public.teammate_routines
  for update using (private.has_org_role(organization_id, 2))
  with check (
    private.has_org_role(organization_id, 2)
    and private.teammate_org(teammate_id) = organization_id
  );

-- 6. concepts and concept_chunks ---------------------------------------------
-- Same predicates as 20260827130000, plus: a Source named by the row lives in
-- the Collection's Organization, and a chunk agrees with its Concept.

drop policy "editors insert org concepts" on public.concepts;
create policy "editors insert org concepts" on public.concepts
  for insert with check (
    exists (
      select 1 from public.knowledge_collections kc
      where kc.id = concepts.collection_id
        and private.can_create_org_knowledge(kc.organization_id)
        and (
          concepts.source_id is null
          or private.source_org(concepts.source_id) = kc.organization_id
        )
    )
  );

drop policy "editors update org concepts" on public.concepts;
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
        and (
          concepts.source_id is null
          or private.source_org(concepts.source_id) = kc.organization_id
        )
    )
  );

drop policy "editors insert org chunks" on public.concept_chunks;
create policy "editors insert org chunks" on public.concept_chunks
  for insert with check (
    exists (
      select 1 from public.knowledge_collections kc
      where kc.id = concept_chunks.collection_id
        and private.can_create_org_knowledge(kc.organization_id)
        and (
          concept_chunks.source_id is null
          or private.source_org(concept_chunks.source_id) = kc.organization_id
        )
    )
    and private.concept_scope_matches(
      concept_chunks.concept_id,
      concept_chunks.collection_id,
      concept_chunks.source_id
    )
  );

drop policy "editors update org chunks" on public.concept_chunks;
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
        and (
          concept_chunks.source_id is null
          or private.source_org(concept_chunks.source_id) = kc.organization_id
        )
    )
    and private.concept_scope_matches(
      concept_chunks.concept_id,
      concept_chunks.collection_id,
      concept_chunks.source_id
    )
  );
