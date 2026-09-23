-- Approval gate (spec ciele-org#948, ticket ciele-org#958).
--
-- One row per action a gate stopped in front of a human: a granted Teammate
-- action or an API request the decision model judged irreversible, outside the
-- actor's stated mandate, or could not judge confidently. The row is created
-- `pending` by the runtime and closed exactly once, by a Member's decision or
-- by the expiry sweep, the same discipline as the Human review gate (#841).
--
-- Its own table, not a nullable `review_requests`. That table's `flow_id` and
-- `action_index` are a cursor into a Flow's action list, which is what its
-- resumption reads; an action stopped here is a tool call inside one model
-- turn and has no such cursor. Making those columns nullable would have made
-- every consumer of #841 handle a case a Flow never produces. Same reasoning,
-- and the same precedent, as the callback gate (#842), which is the review
-- shape with a machine in the middle and is also a table of its own.
--
-- What the row carries is what it takes to run the action if the Member says
-- yes: the operation's name and the input it was called with. Nothing else is
-- re-derived at approval time, because the action a Member approved must be
-- the action that runs.

create table public.action_approvals (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id text not null references public.conversations (id) on delete cascade,
  -- The actor. A Teammate for a granted action; null for an API request a Flow
  -- made, where there is no actor with a mandate.
  teammate_id text references public.teammates (id) on delete cascade,
  -- Who the action is attributed to, which stays the invoking Member even when
  -- the Teammate is the actor (the #770 rule).
  requested_by uuid references auth.users (id) on delete set null,

  -- What would run. `operation` is the ops-layer name for a Teammate action;
  -- `input` is the parsed argument object it was called with.
  operation text not null,
  input jsonb not null default '{}'::jsonb,
  -- For the card and the Inbox: the catalogue's own words, never the model's.
  label text not null,

  -- The verdict that stopped it, for the trace and for anybody asking why.
  reversibility text check (reversibility in ('read_only', 'reversible', 'irreversible')),
  reason text not null
    check (reason in ('irreversible', 'out_of_mandate', 'unsure', 'no_decision')),
  -- Which backend judged it, and how sure it was. Null under no decision.
  backend text check (backend in ('jev', 'adapter')),
  calibrated boolean,
  confidence jsonb not null default '{}'::jsonb,
  map_version integer not null,

  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  -- Set once the approved action has run, which is what keeps a retried claim
  -- from running it twice.
  executed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index action_approvals_org_status_idx
  on public.action_approvals (organization_id, status);
create index action_approvals_conversation_idx
  on public.action_approvals (conversation_id);
create index action_approvals_teammate_idx
  on public.action_approvals (teammate_id)
  where teammate_id is not null;
create index action_approvals_decided_by_idx
  on public.action_approvals (decided_by)
  where decided_by is not null;
-- The expiry sweep's read: pending rows whose clock has run out.
create index action_approvals_pending_expiry_idx
  on public.action_approvals (expires_at)
  where status = 'pending';

alter table public.action_approvals enable row level security;

-- Reading is a Member right: a stopped action is part of the Conversation's
-- transcript. There is deliberately NO member write policy, for the same
-- reason #841 has none: who may approve, and that the first decision wins, is
-- the operation's rule, and an update policy would let a Member PATCH the row
-- past it through PostgREST.
create policy "members read action approvals" on public.action_approvals
  for select using (private.is_org_member(organization_id));

comment on table public.action_approvals is
  'Approval gate (#958): one action stopped in front of a human, decided exactly once.';
comment on column public.action_approvals.input is
  'The parsed arguments the action was called with; the action a Member approves is the action that runs.';
comment on column public.action_approvals.executed_at is
  'Set when the approved action has run. What keeps a retried claim from running it twice.';
