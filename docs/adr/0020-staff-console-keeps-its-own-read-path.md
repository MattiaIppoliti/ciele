# The staff console keeps its own read path, and gets its own tests

## Status

Accepted. Records a **rejection**: an architecture review proposed routing
`apps/admin`'s service-role client through the `Db` seam as a third adapter. That is
forbidden by `apps/admin/CLAUDE.md` and the prohibition is correct. This ADR exists so the
proposal is not made a third time, and so the *real* problem it identified still gets fixed.

## Context

`apps/admin` is the Ciele-staff console at `admin.ciele.app`. It reads through a Supabase
**service-role** client, which bypasses RLS entirely — that is what lets it see every
organization instead of one. `apps/admin/CLAUDE.md` states the consequence bluntly:

> `packages/db` is intentionally **not** a dependency. Do not add it. Its whole contract is
> "org-scoped by RLS", which is false here.

The review's observation was nonetheless real and worth acting on: **the 94-case `Db`
contract suite covers none of the staff console's queries**, because none of them go through
`Db`. Nothing in `platform-data.ts`, `billing-data.ts` or `session.ts` had a test at all. The
two aggregate views those reads depend on (`platform_org_stats`, `platform_daily_usage`,
migration `0017_platform_admin_stats`) are `revoke`d from anon/authenticated, so no RLS test
touches them either. A migration renaming a column in either view would produce blank fields
on every admin page with nothing failing anywhere.

## Decision

**Do not route admin through `Db`.** Two independent reasons, either sufficient:

1. **It would make the interface lie.** `Db`'s contract is not just its type signature; it
   includes "every read is org-scoped and RLS enforces the boundary". Under the service role
   that is false. A reader seeing `db.listMembers(orgId)` in an admin page would reasonably
   conclude tenant isolation was protecting them. Nothing in the *type* stops
   `createSupabaseDb(serviceClient)` — the seam's meaning is what forbids it, and meaning is
   part of an interface.
2. **Most admin reads have no `Db` shape anyway.** `listOrgOverviews`, `getPlatformTotals` and
   `getUsageWindow` read *across all orgs in one query* through the aggregate views. `Db` has
   no cross-org aggregate concept and should not grow one; adding it would widen an org-scoped
   interface with methods that are meaningless under RLS.

**Instead, give the console's own SQL a test against the real schema.** `@agent-hub/db` now
publishes its PGlite harness as a **test-only** subpath, `@agent-hub/db/testing`
(`createSchemaLoadedPglite` — an in-process Postgres with the real migration chain applied).
`apps/admin` takes `@agent-hub/db` as a **devDependency only**, and
`platform-data.views.test.ts` asserts that the two views expose exactly the columns the console
maps, and that the counts they compute are right.

Borrowing the harness is not the thing the rule forbids. The rule is about *programming against
the org-scoped `Db` contract* at runtime; this is a test fixture, and admin's runtime
dependencies are unchanged.

**Supporting change:** every read in `platform-data.ts` now takes its Supabase client as a
defaulted parameter instead of calling `createSupabaseServiceClient()` internally. Production
callers pass nothing; tests pass their own. Before this, no function in the file was reachable
from a test.

## Consequences

- The drift that would have shipped silently — a renamed view column — now fails in CI, on the
  real migrations.
- The console keeps one obvious property: **every query in it is visibly service-role**. There
  is no path where a reader has to know which client backs a call.
- The rule in `apps/admin/CLAUDE.md` gains a stated exception for the test harness, so the next
  reader does not have to guess whether the devDependency is a violation.
- **What is still uncovered**, precisely: `getOrgDetail`'s six per-org queries hit base tables
  through PostgREST embeds, which the harness's query-builder shim does not model; and
  `getOrgAiUsage` goes through the `org_usage_daily` **RPC**, whose signature and return shape
  nothing asserts. Both are unchanged and untested. Widening the shim, or moving those counts
  into the view where the rest already live, is the follow-up.
- Two related things this did *not* touch, both noted so the next reviewer does not re-file them:
  the `private.platform_superusers` allowlist and `PLATFORM_ADMIN_EMAILS` are still two
  independent lists kept in sync by hand (`0034_platform_superusers.sql` asks for it in a
  comment); and `getOrgDetail` still resolves member emails in two round-trips against a stale
  comment claiming parity with `packages/db`, which has used a single embedded select since
  `0020_member_profile_fk`.
