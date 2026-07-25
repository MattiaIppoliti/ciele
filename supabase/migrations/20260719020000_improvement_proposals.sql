-- Suggested Fix (ADR-0017 / #390): a drafted, human-approved knowledge
-- improvement proposal attached to an Improvement. One row per Improvement,
-- created by the drafting job; a Member accepts it (→ a real FAQ Concept) or
-- dismisses it with a reason. OKF stays the record — nothing here edits
-- knowledge until a human accepts.

create table public.improvement_proposals (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  improvement_id text not null references public.improvements (id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'accepted', 'dismissed')),
  -- { draftQuestion, draftAnswer, rationale, sources: [{conceptId, conceptTitle, sourceName}], model }
  payload jsonb not null default '{}'::jsonb,
  -- Reason captured when a Member dismisses the proposal.
  dismiss_reason text not null default '',
  -- The FAQ Concept created when the proposal is accepted (audit trail).
  accepted_concept_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- At most one live proposal per Improvement.
  unique (improvement_id)
);

create index if not exists improvement_proposals_improvement_idx
  on public.improvement_proposals (improvement_id);

alter table public.improvement_proposals enable row level security;

-- Org-scoped, mirroring improvements: members read; editors (rank 2+) manage.
create policy "members read improvement proposals" on public.improvement_proposals
  for select using (private.is_org_member(organization_id));
create policy "editors create improvement proposals" on public.improvement_proposals
  for insert with check (private.has_org_role(organization_id, 2));
create policy "editors update improvement proposals" on public.improvement_proposals
  for update using (private.has_org_role(organization_id, 2));
create policy "editors delete improvement proposals" on public.improvement_proposals
  for delete using (private.has_org_role(organization_id, 2));
