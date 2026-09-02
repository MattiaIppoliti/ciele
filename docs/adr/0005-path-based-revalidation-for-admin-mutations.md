# Admin mutations revalidate by path; cache tags are reserved for shared, cacheable reads

Server actions in `apps/web/src/app/actions.ts` invalidate with **`revalidatePath`** (~40 call
sites), not `revalidateTag`. A performance review (2026-07, NextFaster-playbook engagement) proposed
migrating to granular tags; we evaluated it and **decided against**.

**Why paths are correct here.** Admin reads flow through the request-scoped, RLS-bound `Db`
(`getDb()`, cookie-bound Supabase client) and are **never stored in the server data cache**, they
are per-Member and re-queried on every render (the admin routes are `force-dynamic`). For such
routes, `revalidatePath`'s only real effect is purging the **client router cache** so the mutating
Member sees their change on the next navigation. Tags would have **no server cache entries to
invalidate**, a tag migration would add plumbing to every action and change nothing observable.

**Where tags ARE used.** Shared, publicly cacheable reads: the Publication lookup
(`lib/widget-db.ts`, `unstable_cache` tagged `publication:{assistantId}`, busted by
`invalidatePublication()` via `updateTag` in the publish actions). That is the pattern to follow:
**a read earns a tag when it enters a shared server cache; a mutation earns `revalidateTag` when
such a read exists.** Until an admin read is deliberately moved into a shared cache (which would
also have to confront per-org/per-role scoping under RLS), path-based revalidation is the right
tool, not a shortcut.

**Rejected.**
- *Blanket `revalidatePath` → `revalidateTag` migration.* No server-side cache backs the admin
  reads, so it's churn without effect.
- *Caching admin reads in `unstable_cache` to make tags meaningful.* The reads are RLS-scoped
  per-Member; a shared cache would need org+role in every key, risks cross-tenant leakage for a
  latency win the request-scoped `cache()` dedup (React `cache` on `getDb`/`getSession`) already
  largely delivers.

**Revisit when** an admin surface becomes read-heavy enough that per-org shared caching is worth
the isolation analysis (e.g. Insights over large orgs), that read should then get an org-scoped
tag, following the Publication pattern.

## Amendment (2026-09): the Insights overview enters a shared cache

The revisit clause fired. The Insights overview is an analytical scan of the
30-day window inside the OLTP database, run on every dashboard visit and
growing with the tenant, so `apps/web/src/lib/insights/report.ts` now reads it
through `unstable_cache`. This section records the design the body above
rejected in the abstract and how it answers the two objections.

**Key.** `["insights-overview-rls-v5", organizationId, JSON.stringify(filters)]`.
The Member is not in the key, on purpose. The read policies are
Organization-wide: `assistants` and the tables under it use
`is_org_member(organization_id)` (0003_multi_tenant.sql), and `conversations`
is readable by any member of the owning Assistant's Organization
(0004_runtime.sql). Every Member of an Organization therefore computes the same
numbers, and a per-Member key would multiply the cold scan by the roster size
for no isolation gain.

**Isolation.** A cache miss still runs as the Member: the reader resolves the
session's access token before entering the cache and builds a cookie-free
Supabase client carrying it (`createSupabaseRlsClient`), so RLS decides what
the aggregate sees. The token is an execution credential only; it is never part
of the key or a tag. Nothing request-bound is captured inside the cached
function.

**Invalidation.** One tag, `insights:{organizationId}`
(`lib/insights/cache.ts`). `revalidateEntities` in `lib/org-mutation.ts` expires
it whenever a mutation declares an entity the aggregate reads; the entity table
carries an `insights` flag beside each kind's paths, so the two questions
("which routes", "does Insights care") are answered by one row. The kinds
flagged today are `assistant`, `assistantList`, `inbox`, `improvement` and
`improvementList`. `DELETE /api/insights` expires the same tag on demand for a
signed-in Member. Freshness rule: a dashboard number may be up to five minutes
old, or older than the last relevant console mutation by nothing. Widget
traffic (a new Conversation, a Visitor's thumbs, CSAT, an escalation) does not
expire the tag, on purpose: those routes fire on every chat, and a tag that
every chat expires is no cache. It reaches the overview when the entry ages
out.

**What did not change.** Every other admin read is still request-scoped and
uncached, and path revalidation is still the rule for mutations. The
Publication cache keeps its own tag. "Where tags ARE used" above now lists two
reads, the Publication lookup and the Insights overview, and the rule that
earns a tag is unchanged: a read gets one when it enters a shared server cache.
