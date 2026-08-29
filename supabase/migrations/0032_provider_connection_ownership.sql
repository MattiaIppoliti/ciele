-- Provider connections: subscription reuse + BYOK hardening (ADR-0001).
-- key_hint is a non-secret display suffix ("…abcd") so admins can tell keys
-- apart without ever seeing the sealed secret. created_by (added in 0004,
-- never populated until now) records the connecting Member, subscription
-- connections are personal and resolve only for that Member, in Preview only.

alter table public.provider_connections
  add column key_hint text not null default '';

-- Editors and above may connect their own personal subscription; API keys
-- stay admin-managed.
drop policy "admins manage connections" on public.provider_connections;
create policy "admins insert connections" on public.provider_connections
  for insert with check (
    private.has_org_role(organization_id, 3)
    or (
      type = 'subscription'
      and private.has_org_role(organization_id, 2)
      and created_by = auth.uid()
    )
  );

-- Admins remove anything; a Member may disconnect their own subscription.
drop policy "admins delete connections" on public.provider_connections;
create policy "admins or owners delete connections" on public.provider_connections
  for delete using (
    private.has_org_role(organization_id, 3)
    or (type = 'subscription' and created_by = auth.uid())
  );
