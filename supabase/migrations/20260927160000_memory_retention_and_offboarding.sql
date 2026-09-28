-- Personal memory follows the retention and membership it came from.
--
-- Two gaps, both about data derived from a person outliving the reason it was
-- kept:
--
-- 1. A Visitor's long-term memories (#664) are facts distilled from their
--    Conversations, and point at the Conversation with ON DELETE SET NULL. The
--    transcript-retention sweep deleted the Conversation and left the facts,
--    unlinked, forever. `delete_expired_memories` applies the same window to
--    them, by last update, so a fact still being reinforced stays.
-- 2. Removing a Member deleted their `organization_members` row and nothing
--    else. Their User-layer memory document in that Organization stayed, and
--    came back if they were invited again. RLS hides that document from the
--    admin who removes them, so the cleanup is a security-definer trigger on the
--    membership row; its history goes with it through the document FK.

create or replace function public.delete_expired_memories(
  p_organization_id uuid,
  p_cutoff timestamptz,
  p_limit integer default 5000
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  deleted integer;
begin
  with expired as (
    select m.id
    from public.memories m
    where m.organization_id = p_organization_id
      and m.updated_at < p_cutoff
    order by m.updated_at
    limit greatest(p_limit, 1)
  )
  delete from public.memories m
  using expired
  where m.id = expired.id;
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

create index if not exists memories_org_updated_idx
  on public.memories (organization_id, updated_at);

create or replace function private.remove_departed_member_memory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.memory_documents
  where organization_id = old.organization_id
    and member_id = old.user_id;
  return old;
end
$$;

drop trigger if exists organization_members_remove_memory on public.organization_members;
create trigger organization_members_remove_memory
after delete on public.organization_members
for each row execute function private.remove_departed_member_memory();
