-- A revoked API key can be deleted from the console. Only revoked ones: an
-- active key has to be revoked first, so a credential never disappears while
-- it still authenticates. Admin tier, like every other write on this table.
create policy "admins delete revoked api keys" on public.organization_api_keys
  for delete using (
    private.has_org_role(organization_id, 3) and revoked_at is not null
  );
