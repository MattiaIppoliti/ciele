-- My Tasks reads a Member's assigned Improvements (ADR-0027, Consequences):
-- `listImprovementsAssignedTo` filters on the Organization and the assignee,
-- and the only index so far covered `assignee_id` alone.

create index if not exists improvements_org_assignee_idx
  on public.improvements (organization_id, assignee_id);
