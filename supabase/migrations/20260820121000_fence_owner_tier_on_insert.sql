-- Ownership stays owner-only on INSERT too, and next_improvement_seq stops
-- trusting the org it is handed.
--
-- 20260728120000 fenced Admins off the owner tier for UPDATE and DELETE on
-- organization_members, stating the invariant: "an Admin must not be able to
-- grant themselves ownership or demote an Owner". It left both INSERT policies
-- untouched, and they only test rank, never `role`. Two ways to defeat the
-- invariant remained:
--
--   1. insert an owner row directly for a second account under the Admin's
--      control (the (organization_id, user_id) PK blocks doing it for oneself);
--   2. cheaper, one account and no second signup: create an `owner` invite,
--      self-leave (the delete policy permits `user_id = auth.uid()` at any
--      role), then call `accept_invite`, whose SECURITY DEFINER insert applies
--      `inv.role` with no policy in the way and no PK conflict left to hit.
--
-- Owner is a real boundary above Admin: `owner updates org` (rank 4) covers
-- every column later added to organizations, only an Owner may grant or revoke
-- ownership, and an API key's role is capped at its creator's, so only an Owner
-- can mint an owner-rank key. Fence both INSERTs with the same predicate the
-- UPDATE policy already uses, which closes path 2 at its first step.
--
-- The app layer agrees but cannot be the boundary: `createInviteOp` and
-- `assertMayManageTier` guard the server-action route, and PostgREST is reachable
-- directly with the browser-visible anon key plus the caller's own session JWT.

drop policy if exists "admins add members" on public.organization_members;

create policy "admins add members, owners add owners"
  on public.organization_members
  for insert
  with check (
    private.has_org_role(organization_id, 4)
    or (private.has_org_role(organization_id, 3) and role <> 'owner')
  );

drop policy if exists "admins create invites" on public.organization_invites;

create policy "admins create invites, owners invite owners"
  on public.organization_invites
  for insert
  with check (
    private.has_org_role(organization_id, 4)
    or (private.has_org_role(organization_id, 3) and role <> 'owner')
  );

-- `next_improvement_seq(org)` is SECURITY DEFINER, is granted to `authenticated`
-- (0018/0026), lives in the PostgREST-exposed `public` schema, and never checked
-- who the caller is. `improvement_counters` has a SELECT-only policy, so the
-- definer rights were the only reason the write landed at all. Any authenticated
-- user who knows an Organization's uuid could POST /rest/v1/rpc/
-- next_improvement_seq and bump that org's Improvement numbering; the RETURNING
-- expression also handed back the victim's pre-call `next_seq`, which leaks how
-- many Improvement items they have ever created.
--
-- 0018's own comment flagged the gap ("each already requires auth.uid() to be
-- set except next_improvement_seq, which is only ever reached from an
-- authenticated org member's 'create improvement' flow") -- true of the app, not
-- of the API surface. Guard on the same tier that may create an Improvement.

-- The check is on the *caller*, which is why it is conditional on there being
-- one. `private.has_org_role` resolves the member through `auth.uid()`, so it is
-- false for a service-role connection, and this function is on two service-role
-- paths that must keep working: the widget's escalation auto-Improvement
-- (apps/web/src/lib/escalation.ts) and the compost cron
-- (packages/agent/src/compost.ts). Both already hold a key that bypasses RLS
-- everywhere else, so gating them here would buy nothing and break the feature.
-- An authenticated caller, which is the one that can reach PostgREST, must be an
-- Editor of the org it names.
create or replace function public.next_improvement_seq(org uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare allocated integer;
begin
  if auth.uid() is not null and not private.has_org_role(org, 2) then
    raise exception 'not authorized';
  end if;
  insert into improvement_counters (organization_id, next_seq)
  values (org, 2)
  on conflict (organization_id)
  do update set next_seq = improvement_counters.next_seq + 1
  returning next_seq - 1 into allocated;
  return allocated;
end $$;
