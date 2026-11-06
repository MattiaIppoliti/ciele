-- The "Create a ticket" Support Channel files a record (ciele-org#1088, #1089).
--
-- 1. help_desks.ticketing_target: where a desk's ticket channel files. It
--    names an Organization-owned Application Connection (Salesforce or
--    ServiceNow) and, for ServiceNow, a table and a requester-email column.
--    It holds no credential: the Connection does, sealed, so the target can be
--    read anywhere the desk is without carrying a secret.
--
-- 2. escalation_tickets: one row per ticket-channel submission, claimed before
--    the provider call under a unique (organization, idempotency key). A widget
--    retry with the same request id finds the row instead of filing a second
--    Case. The provider has no idempotency header of its own, so this table is
--    the only thing that makes a retry safe.
--
-- 3. The expand step of retiring the password-grant ServiceNow registration
--    (help_desks.ticketing_integration). The console no longer offers it and
--    nothing files through it; each desk still holding one gets an Alert asking
--    an admin to connect ServiceNow as an Application Connection. A later
--    migration (the contract step) drops the column and its sealed secrets.

alter table public.help_desks
  add column if not exists ticketing_target jsonb;

comment on column public.help_desks.ticketing_target is
  'Where the desk''s "Create a ticket" channel files (#1088): {provider, connectionId[, table, requesterEmailField]}. No credential.';

create table public.escalation_tickets (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  idempotency_key text not null,
  help_desk_id text not null references public.help_desks (id) on delete cascade,
  channel_id text not null references public.support_channels (id) on delete cascade,
  conversation_id text references public.conversations (id) on delete set null,
  provider text not null check (provider in ('salesforce', 'servicenow')),
  status text not null default 'pending'
    check (status in ('pending', 'filed', 'failed')),
  -- {provider, id, number, url} once filed.
  ticket jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

-- Covering indexes for the three cascading foreign keys (the unique above
-- covers organization_id).
create index escalation_tickets_help_desk_idx
  on public.escalation_tickets (help_desk_id);
create index escalation_tickets_channel_idx
  on public.escalation_tickets (channel_id);
create index escalation_tickets_conversation_idx
  on public.escalation_tickets (conversation_id)
  where conversation_id is not null;

alter table public.escalation_tickets enable row level security;

-- Members may read what their Organization filed. There is deliberately no
-- member write policy: the widget's escalation transaction claims and settles
-- rows through the system Db, and a Member PATCH through PostgREST must not be
-- able to mark a submission filed.
create policy "members read escalation tickets" on public.escalation_tickets
  for select using (private.is_org_member(organization_id));

comment on table public.escalation_tickets is
  'Ticket-channel submissions (#1088): claimed before the provider call so a retried request files once.';

insert into public.alerts (id, organization_id, type, title, detail, status, source_key)
select
  'al-tkt-' || substr(md5(d.id), 1, 12),
  d.organization_id,
  'integration',
  'Reconnect ServiceNow ticketing for ' || d.name,
  'The help desk "' || d.name || '" uses a ServiceNow ticketing integration '
    || 'that signs in with a stored password. That integration is retired, '
    || 'and no ticket is filed through it. Connect ServiceNow under '
    || 'Knowledge → Applications, then choose that connection in the desk''s '
    || 'Ticketing Integration section. The stored credentials will be deleted '
    || 'in a later release.',
  'active',
  'ticketing-legacy:' || d.id
from public.help_desks d
where d.ticketing_integration is not null
on conflict (id) do nothing;
