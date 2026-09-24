-- PostgREST creates a Source with INSERT ... RETURNING. At that point the
-- Source has no assistant_sources links. The old SELECT policy called
-- can_read_source(id), whose fallback looked the Source up again through a
-- STABLE security-definer function. That lookup cannot see the row being
-- inserted in the same statement, so RETURNING failed with RLS error 42501
-- even though the INSERT policy accepted the editor's row.
--
-- For the Source table we already have its collection_id in the policy row.
-- Check the Collection directly for the unlinked case. Linked Sources keep
-- the existing per-Assistant reach rule.
drop policy if exists "members read org sources" on public.sources;
create policy "members read org sources" on public.sources
  for select using (
    case
      when exists (
        select 1 from public.assistant_sources l where l.source_id = sources.id
      ) then private.can_read_source(id)
      else exists (
        select 1 from public.knowledge_collections kc
        where kc.id = sources.collection_id
          and private.is_org_member(kc.organization_id)
      )
    end
  );
