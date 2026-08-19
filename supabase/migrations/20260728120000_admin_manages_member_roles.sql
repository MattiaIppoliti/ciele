-- Admins may change member roles; ownership stays owner-only.
--
-- 0003 reserved every role update for owners ("owner updates roles"). The
-- Members table lets Admins and Owners edit roles, so the policy widens to
-- rank 3, but an Admin must not be able to grant themselves ownership or
-- demote an Owner. For an UPDATE policy `using` sees the row as it is and
-- `with check` the row as it will be, so naming `role <> 'owner'` in both
-- fences an Admin off the owner tier from either direction.

drop policy if exists "owner updates roles" on public.organization_members;

create policy "admins update roles, owners update owners"
  on public.organization_members
  for update
  using (
    private.has_org_role(organization_id, 4)
    or (private.has_org_role(organization_id, 3) and role <> 'owner')
  )
  with check (
    private.has_org_role(organization_id, 4)
    or (private.has_org_role(organization_id, 3) and role <> 'owner')
  );

-- Same asymmetry on removal: 0003 let any Admin delete any row, owners
-- included. Removing the last Owner would strand the Organization, so an
-- Admin can remove everyone but an Owner; owners and self-leave are unchanged.

drop policy if exists "admins remove members or self-leave"
  on public.organization_members;

create policy "admins remove members or self-leave"
  on public.organization_members
  for delete
  using (
    private.has_org_role(organization_id, 4)
    or (private.has_org_role(organization_id, 3) and role <> 'owner')
    or user_id = (select auth.uid())
  );
