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
