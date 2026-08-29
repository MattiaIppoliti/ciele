-- Teammate action grants: what an AI Teammate may do, as rows
-- (spec ciele-org#767, ticket ciele-org#770).
--
-- The model is deliberately the opposite of a permissions bitmask: one row per
-- (Teammate, domain), and **no row means no tool**. There is no `enabled`
-- column, because a disabled grant and an absent grant mean the same thing to
-- the runtime, and only one of the two can be misread. Revoking deletes.
--
-- Two knobs sit beside the rows, both on the Teammate: the ceiling, which caps
-- every granted domain at once, and the approval-bypass, which is the single
-- explicit relaxation of ADR-0017's "a Member must accept" invariant.

create table public.teammate_grants (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  teammate_id text not null references public.teammates (id) on delete cascade,
  -- Closed vocabulary (`TeammateGrantDomain`). A row naming something else is
  -- not a weaker grant, it is a typo, so the constraint refuses it rather than
  -- letting the runtime silently register no tools for it.
  domain text not null check (domain in ('improvements', 'knowledge', 'inbox')),
  -- The admin who granted it. Survives their account deletion as null: the
  -- grant is the Organization's, not theirs.
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- One row per domain. Granting twice is the same grant, and a duplicate row
  -- would make revoking a two-step operation that can half-succeed.
  unique (teammate_id, domain)
);

create index teammate_grants_teammate_idx on public.teammate_grants (teammate_id);
create index teammate_grants_org_idx on public.teammate_grants (organization_id);

alter table public.teammate_grants enable row level security;

-- Reading is a Member right: what a Teammate may do is not a secret from the
-- colleagues it works with, and the roster shows it. Writing is admin-only,
-- one rung above the Editor who may rename the Teammate and pick its
-- knowledge. That gap is the point: granting a capability is a security
-- decision, editing a persona is not.
create policy "members read teammate grants" on public.teammate_grants
  for select using (private.is_org_member(organization_id));
create policy "admins create teammate grants" on public.teammate_grants
  for insert with check (private.has_org_role(organization_id, 3));
create policy "admins update teammate grants" on public.teammate_grants
  for update using (private.has_org_role(organization_id, 3));
create policy "admins delete teammate grants" on public.teammate_grants
  for delete using (private.has_org_role(organization_id, 3));

-- The two per-Teammate knobs -------------------------------------------------
--
-- Columns on `teammates` rather than a second table: there is exactly one of
-- each per Teammate, and a row that must always exist is a column. They are
-- kept out of the Editor-writable patch type in the domain package
-- (`TeammatePatch` vs `TeammateGovernancePatch`) and written only by the
-- admin-capability grants operation.

alter table public.teammates
  add column capability_ceiling text not null default 'edit'
    check (capability_ceiling in ('member', 'edit', 'publish'));

-- No `manageMembers` / `manageApiKeys` / `changeRoles` rung exists here at all.
-- A Teammate that administers the Organization is not a capability we want to
-- be one bad default away from, so the ladder simply stops at publish.

alter table public.teammates
  add column approval_bypass boolean not null default false;

comment on column public.teammates.approval_bypass is
  'ADR-0017 amendment (#770): when true this Teammate may accept its own Suggested Fixes, writing a FAQ Concept with no human in the loop. Requires the knowledge grant as well; false by default and never implied by any grant.';
