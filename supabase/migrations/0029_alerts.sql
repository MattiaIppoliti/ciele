-- Alerts: operational-health issues the system raises for admin attention
-- (integration/crawl/provider failures). An alert persists until an admin
-- resolves it ("I have resolved this") or the underlying issue clears —
-- auto-resolve matches on source_key when the failing operation succeeds again.

create table public.alerts (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  type text not null default 'system'
    check (type in ('integration', 'crawl', 'provider', 'system')),
  title text not null,
  detail text not null default '',
  status text not null default 'active'
    check (status in ('active', 'resolved')),
  -- Dedup key for system-raised alerts (e.g. "website-source:<id>"): raising
  -- again while active refreshes the row instead of duplicating it.
  source_key text,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  -- Set for manual resolves; stays null when the issue cleared on its own.
  resolved_by uuid references auth.users (id)
);

create index if not exists alerts_organization_id_idx
  on public.alerts (organization_id);
create index if not exists alerts_status_idx
  on public.alerts (organization_id, status);
create unique index if not exists alerts_active_source_key_idx
  on public.alerts (organization_id, source_key)
  where status = 'active' and source_key is not null;

alter table public.alerts enable row level security;

-- Org-scoped: members read; editors (rank 2) and above raise/resolve. System
-- raises happen inside user-initiated server actions, so the editor policy
-- covers them.
create policy "members read alerts" on public.alerts
  for select using (private.is_org_member(organization_id));
create policy "editors create alerts" on public.alerts
  for insert with check (private.has_org_role(organization_id, 2));
create policy "editors update alerts" on public.alerts
  for update using (private.has_org_role(organization_id, 2));
create policy "editors delete alerts" on public.alerts
  for delete using (private.has_org_role(organization_id, 2));
