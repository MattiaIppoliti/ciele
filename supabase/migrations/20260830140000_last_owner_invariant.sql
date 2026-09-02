-- The Owner invariant, enforced by the database (#801, CYB-11).
--
-- `assertNotLastOwner` in packages/ops reads the roster and then writes, which
-- is check-then-act: two admins demoting the same Organization's two owners at
-- the same moment each see two owners, each decides it is safe, and both
-- commit. The Organization is then locked out of its own member management for
-- good, because appointing an Owner is itself an Owner-tier change.
--
-- The application check stays: it is what produces a readable error instead of
-- a constraint violation, and it refuses before any other work happens. This
-- is the one that holds under concurrency.
--
-- A CHECK constraint cannot express "at least one row matching a predicate",
-- so it is a constraint trigger, deferred to commit. Deferral is what makes it
-- correct rather than merely strict:
--
--   * a handover written as several statements passes through a moment with no
--     Owner, and only the state at commit is a real state;
--   * deleting an Organization cascades to its members first, so at row time
--     the parent still exists and a non-deferred check would refuse. At commit
--     the Organization is gone, and an Organization that does not exist cannot
--     be left without an Owner.

create or replace function private.assert_organization_keeps_an_owner()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target uuid := coalesce(old.organization_id, new.organization_id);
begin
  -- Gone entirely: nothing to keep an Owner for.
  if not exists (select 1 from public.organizations where id = target) then
    return null;
  end if;

  if not exists (
    select 1
    from public.organization_members
    where organization_id = target
      and role = 'owner'
  ) then
    raise exception 'organization % would be left with no owner', target
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

comment on function private.assert_organization_keeps_an_owner is
  'Refuses, at commit, any transaction that would leave an Organization with no Owner (#801, CYB-11).';

drop trigger if exists organization_members_keep_an_owner on public.organization_members;
create constraint trigger organization_members_keep_an_owner
  after delete or update on public.organization_members
  deferrable initially deferred
  for each row
  execute function private.assert_organization_keeps_an_owner();
