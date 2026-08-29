-- Provider connections: hosted subscription reuse is retired.
-- API keys and future federated connections stay org-admin managed.

drop policy if exists "admins insert connections" on public.provider_connections;
create policy "admins insert connections" on public.provider_connections
  for insert with check (private.has_org_role(organization_id, 3));

drop policy if exists "admins or owners delete connections" on public.provider_connections;
create policy "admins delete connections" on public.provider_connections
  for delete using (private.has_org_role(organization_id, 3));
