-- The callback gate (ticket ciele-org#842) and the inbound-HTTP trigger (#843).
--
-- A Flow Action that subscribes to an external system, stops the turn, and
-- continues when that system calls back. One row per awaited callback: created
-- `pending` by the runtime *before* the subscribe request goes out (the
-- callback URL names the row, so the row has to exist first), closed exactly
-- once by the first callback or by the expiry sweep, and read back by the
-- resumption job for where to continue (`action_index`) and what arrived
-- (`payload`).
--
-- The unsubscribe call is stored resolved rather than re-read from the Flow at
-- resume time: it has to fire even when the Flow was edited during the wait,
-- and an unsubscribe pointed at the wrong URL is a subscription nobody stops.
--
-- Nothing here references a Publication, and nothing here is a credential: the
-- callback is authorized by a signed URL minted per row, so a snapshot carries
-- no secret.

create table public.webhook_subscriptions (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  assistant_id text not null references public.assistants (id) on delete cascade,
  -- Cascades with the Conversation it belongs to. A pending row deleted this
  -- way never sends its unsubscribe, so the other system keeps a subscription
  -- pointed at an address that no longer resolves. Accepted rather than solved:
  -- the alternative is an orphan row holding a Conversation id that is gone,
  -- and the wait it represents ended when the Conversation did.
  conversation_id text not null references public.conversations (id) on delete cascade,
  flow_id text not null,
  action_index integer not null check (action_index >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'received', 'expired', 'failed')),
  subscribe_method text not null,
  subscribe_url text not null,
  unsubscribe_method text,
  unsubscribe_url text,
  unsubscribe_body text,
  unsubscribed_at timestamptz,
  -- The callback body, capped by the runtime. The actions after the gate
  -- extract from it; this is not an archive of what the caller sent.
  payload text,
  received_at timestamptz,
  expires_at timestamptz not null,
  halt_message text not null default '',
  simulated boolean not null default false,
  -- Set once the continuation (or the halt message) has been persisted, which
  -- is what makes the resumption job idempotent across a retried claim.
  resumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index webhook_subscriptions_org_status_idx
  on public.webhook_subscriptions (organization_id, status);
create index webhook_subscriptions_conversation_idx
  on public.webhook_subscriptions (conversation_id);
create index webhook_subscriptions_assistant_idx
  on public.webhook_subscriptions (assistant_id);
-- The expiry sweep's read: pending rows whose clock has run out.
create index webhook_subscriptions_pending_expiry_idx
  on public.webhook_subscriptions (expires_at)
  where status = 'pending';

alter table public.webhook_subscriptions enable row level security;

-- Reading is a Member right: the gate is part of a Conversation's transcript in
-- the Inbox. There is deliberately NO member write policy. The one thing that
-- closes a row is an unauthenticated caller holding a signed URL, which the
-- runtime verifies and applies through the system Db; a member update policy
-- would let any Member PATCH a row past "the first callback wins" through
-- PostgREST, and that rule is the whole protection against a Flow's remaining
-- actions running twice.
create policy "members read webhook subscriptions" on public.webhook_subscriptions
  for select using (private.is_org_member(organization_id));

comment on table public.webhook_subscriptions is
  'Callback gate (#842): one awaited webhook callback, closed exactly once.';
comment on column public.webhook_subscriptions.action_index is
  'Index of the http_webhook action in the Flow; the resumption turn runs the actions after it.';
comment on column public.webhook_subscriptions.unsubscribe_url is
  'Resolved at subscribe time so it still fires when the Flow is edited during the wait.';

-- The job kind the gate owns: continuing (or halting) the Conversation once
-- the subscription closes. Subscribing itself is not a job — it runs inline in
-- the action, because a subscribe that fails must halt the Flow then and there
-- rather than leave a Visitor waiting on a request nobody made.
alter table public.background_jobs
  drop constraint if exists background_jobs_kind_check;
alter table public.background_jobs
  add constraint background_jobs_kind_check
  check (kind in (
    'ingest_source',
    'graph_sync_concept',
    'draft_improvement_proposal',
    'promote_memories',
    'distill_agent_memory',
    'sync_entity_records',
    'sync_application_import',
    'deliver_review_request',
    'resume_reviewed_conversation',
    'resume_webhook_conversation'
  ));
