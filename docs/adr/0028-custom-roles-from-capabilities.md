# Custom Roles are sets of Capabilities, checked in every layer

## Status

Accepted, 2026-11-04. Map #1164. Decided in one pass for the grilling tickets #1167 (catalogue),
#1168 (enforcement), #1169 (built-ins, reset, lockout), #1170 (Assistant level, partly), #1172
(data model) and #1174 (migration), on the two research notes #1165 and #1166. The prototypes
#1171 and #1173 were not built; the pages shipped directly.

## Context

A Member held one of five ladder Roles, and every check compared a rank: each Operation declared
one of seven rungs (`member`, `edit`, `operate`, `publish`, `manageMembers`, `manageApiKeys`,
`changeRoles`) and 151 of 321 RLS policies call `private.has_org_role(org, n)`. An Organization
could not say "this person publishes and does nothing else", nor change what an Editor may do.

The research fixed three costs. A Capability check per row in RLS runs once per row unless it is
written as `org in (select private.orgs_with('x'))`. Capabilities stamped into the JWT go stale for
up to an hour and do not fit Vercel's header limit. API keys run as the service role and never meet
RLS under any option, so their Capability check lives in application code whatever we choose.

## Decision

1. **A Capability is `area:action`**, two segments, from a closed catalogue in
   `packages/core/src/capabilities.ts` (67 today, in 13 bundles). Each one exists because an
   Operation needs it; there is none for a feature Ciele does not have. Each carries the **tier** it
   was held at before (the old rung), the levels it applies at (Organization, or also Assistant),
   and what it requires.
2. **Every Operation declares exactly one Capability**, or `member` for a Member's own things
   (notification preferences, favorites, leaving). The 302 declarations were mapped mechanically and
   checked so each Capability's tier equals the rung its Operations declared.
3. **A Role is a row** in `org_roles`: name, description, Capability list, availability
   (Organization, Assistant, or both). Six built-ins are seeded per Organization: Owner, Admin,
   Editor, Support Agent, Viewer and the new Data Viewer (Assistants and Insights only).
4. **Built-in defaults are derived from the tiers.** A ladder built-in holds a Capability exactly
   when its old rung reached that tier, which is the migration: nobody gains or loses anything on
   the day it ships. The migration backfills `role_id` from the old `role` names.
5. **Every layer checks the Capability.** The Operation layer checks the exact Capability on
   every surface (console, `/api/v1`, the CLI, MCP, Ciele AI) through one `authorizeOperation`.
   RLS checks it too: `20261104170000_capability_rls` rewrites the rank write policies and their
   helper functions to `organization_id in (select private.orgs_with('x'))`, and an Assistant's
   rows to `private.has_assistant_capability(assistant, 'x')`. The old `role` columns on members,
   invitations, API keys and Assistant rows stay, as the Role's **tier** (the highest tier among
   its Capabilities, kept by trigger), for what is a tier by design: runtime and ledger tables the
   console never writes directly (`background_jobs`, `entities*`, `memory_document*`,
   `thread_preferences`) and the Owner and Admin oversight reads. The Rust service checks the
   Capabilities the web app signs into its assertion, and its API keys use key ∩ creator.
6. **The privilege tables check Capabilities in RLS anyway**: members, invitations, API keys,
   Roles and Assistant access, through `private.orgs_with`, and taking over a Conversation
   (`private.can_operate_conversations` is now `inbox:operate`). These are where a tier-only bound
   would be an escalation path, for example a Publisher Role at the Admin tier minting an Admin key.
7. **Nobody hands on what they do not hold.** Creating or editing a Role, assigning one, inviting
   with one and minting an API key with one all require every Capability of that Role, Owners
   exempt. The database refuses it too (`private.assert_may_hand_on`, `org_roles_normalize`).
   Granting a Teammate a domain requires every Capability that domain's actions reach at the
   Teammate's ceiling, because a Teammate acts with its grants, not with the invoker's Role.
   Three rows would otherwise let a partial admin reach further, so they are fenced for a
   Member's own token: an API key's secret, delegator and revocation cannot be rewritten, a
   membership cannot move to another account, and an invitation's token is readable only by
   someone who could create that invitation.
8. **Owner is locked**: every Capability, including ones added later, no edit, no reset, no delete.
   Ownership still changes through Members. The one Owner-only Capability is
   `personalSubscriptions:manage`; no other Role may hold it.
9. **No Member edits the Role they hold**, Owners aside. With rule 7 and Owner locked, nobody can
   lock the Organization out: an Owner always holds everything.
10. **A held Role cannot be deleted.** Members, pending invitations and active API keys move first.
    Accepted invitations and revoked keys fall back to the built-in of their tier on delete, which
    grants nothing because neither can act. Built-ins are never deleted.
11. **New Capabilities**: a release that adds one adds a row to `private.capability_catalog` and
    updates every built-in that is not `customized`. An edited built-in and every custom Role get
    nothing new until an admin turns it on. "Reset to default" restores today's defaults, not the
    ones of the release that created the Role.
12. **API keys carry any Role** (`role_id`). A key acts with the intersection of its Role's
    Capabilities and its creator's current ones; that is the existing "the lower of the key's Role
    and the creator's" rule, per Capability.
13. **Old clients keep working.** Every assignment accepts `roleId` or `role`, a built-in by name;
    a writer that sets only the old `role` column lands on the built-in of that name.

## Consequences

- A Role on one Assistant replaces the Organization Role there, up or down, for the
  Assistant-level Capabilities only (`effectiveAssistantCapabilities` in core, the same rule in
  `private.has_assistant_capability`). Operations name the Assistant they act on (input
  `assistantId`, `id` on `assistants.*`, or a resolver for Flow and Conversation ids). An API key
  stays under its own Role there, and a refusal only that Assistant explains answers 404, as a
  denied Assistant does.
- The console gates each control on the Capability of the operation behind it (`can(access, x)`
  in `lib/rbac.ts`); an Assistant's pages use the Member's Capabilities on that Assistant. Nav
  entries declare the Capability their page needs, and a direct URL to the rest shows the
  permission page. Only the Settings rail still follows the tier, because it is the
  Organization's administration and each tab checks its own Capability.
- The model's own reasoning is `inbox:reasoning`, stripped server-side for anyone without it.
- One Role is the invitation default and one the Assistant default (Editor and Viewer at first),
  moved with **Manage defaults**. A default cannot be deleted or moved off its level.
- A directly written Role is closed over its requirements in SQL, as the editor and the
  operations close it.
- The Teammate ceiling is renamed the **Action Ceiling** (`teammates.action_ceiling`,
  `20261104150000`), so Capability means one thing. It keeps its tiers and compares the tier of an
  Operation's Capability.
- `/api/v1/roles`, `ciele roles` and the `role_*` actions of `manage_organization` manage Roles;
  members, invitations, keys and Assistant rows take a `roleId`; `whoami` reports a key's
  Capabilities.
- Ciele AI may run the Role operations, with the Member's own Capabilities and an approval card
  for each, like every other consequential operation.
- The Roles pages also open inside the Settings dialog, like every other Settings tab; they are
  real routes either way.
