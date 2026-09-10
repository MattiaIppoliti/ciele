-- Human review (spec ciele-org#836, ticket ciele-org#841).
--
-- A Flow Action that stops the turn and asks named Members for approval by
-- email or Slack. The gate's state is one row per request: created `pending`
-- by the runtime, closed exactly once by the first Member's decision or by
-- the expiry sweep, and read back by the resumption job for where to continue
-- (`action_index`) and what the assignee typed (`decision`).
--
-- Linear, not a branch: approved runs the Flow's remaining actions, rejected
-- and expired persist the halt message. Nothing here references a Publication,
-- so a snapshot carries no request and no credential.

create table public.review_requests (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  assistant_id text not null references public.assistants (id) on delete cascade,
  conversation_id text not null references public.conversations (id) on delete cascade,
  flow_id text not null,
  action_index integer not null check (action_index >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired')),
  title text not null,
  message text not null default '',
  summary text not null default '',
  channel text not null check (channel in ('email', 'slack')),
  -- Lower-cased Member emails. Resolved against the roster at Publish; stored
  -- as text because a Member who leaves must not take the request with them.
  assignees jsonb not null default '[]'::jsonb,
  inputs jsonb not null default '[]'::jsonb,
  decision jsonb,
  decided_by uuid references auth.users (id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  expires_at timestamptz not null,
  halt_message text not null default '',
  -- Preview and Teammate turns raise a request nobody is emailed about; the
  -- transcript decides it inline. Kept as a row so the same decide path runs.
  simulated boolean not null default false,
  -- Set once the approval turn (or the halt message) has been persisted, which
  -- is what makes the resumption job idempotent across a retried claim.
  resumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index review_requests_org_status_idx
  on public.review_requests (organization_id, status);
create index review_requests_conversation_idx
  on public.review_requests (conversation_id);
create index review_requests_assistant_idx
  on public.review_requests (assistant_id);
-- The decider FK's covering index (a Member delete sets it null through it).
create index review_requests_decided_by_idx
  on public.review_requests (decided_by)
  where decided_by is not null;
-- The expiry sweep's read: pending rows whose clock has run out.
create index review_requests_pending_expiry_idx
  on public.review_requests (expires_at)
  where status = 'pending';

alter table public.review_requests enable row level security;

-- Reading is a Member right: the request is part of a Conversation's transcript
-- in the Inbox. There is deliberately NO member write policy: who may close a
-- request (an assignee or an Owner/Admin) and when (first decision wins) is
-- the decide operation's rule, and a member update policy would let any Member
-- PATCH the row past it through PostgREST. The runtime creates rows and the
-- decide operation writes them through the system Db, both behind the
-- operations layer.
create policy "members read review requests" on public.review_requests
  for select using (private.is_org_member(organization_id));

comment on table public.review_requests is
  'Human review gate (#841): one approval request a Flow raised, decided exactly once.';
comment on column public.review_requests.action_index is
  'Index of the human_review action in the Flow; the resumption turn runs the actions after it.';

-- The two job kinds the gate owns: delivering the request, and continuing (or
-- halting) the Conversation once it closes.
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
    'resume_reviewed_conversation'
  ));

-- The email sender: a Member-owned Microsoft 365 mail Connection (#841).
alter table public.application_connections
  drop constraint if exists application_connections_provider_check;
alter table public.application_connections
  add constraint application_connections_provider_check
  check (provider in ('salesforce', 'servicenow', 'slack', 'onedrive', 'google_drive', 'microsoft_mail'));
