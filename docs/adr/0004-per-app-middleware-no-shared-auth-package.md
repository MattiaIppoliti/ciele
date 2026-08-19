# Each app owns its middleware: no shared Supabase auth-middleware package

`apps/web/src/middleware.ts` and the middleware of the enterprise-edition staff console (an app
outside the open-source distribution) both perform the same ~25-line Supabase SSR cookie dance
(`@supabase/ssr` client, session refresh, redirect-to-login) before diverging into their own guards.
An architecture review (July 2026) flagged the duplication and proposed a shared
`createSupabaseMiddleware(guard)` factory package that both apps, and any future app, would
consume.

**Decision.** Keep one middleware per app, duplicated cookie dance and all. Do not introduce a
shared auth-middleware package.

**Rationale.**
- **Different trust boundaries, on purpose.** `apps/web` gates tenant Members into an org-scoped
  session that RLS depends on; the staff console gates operators via an email allowlist in front of
  a **service-role** client that intentionally bypasses that same RLS, and frames that gate as a
  deliberate placeholder for an SSO swap. A shared factory would blur the most security-sensitive
  distinction in the codebase behind one generic interface.
- **Independent deployments.** The two apps ship to different domains on different cadences. A
  shared package turns every middleware tweak into a change-amplification point across both
  deployments, the opposite of the locality the review was optimizing for.
- **The savings are ~25 stable lines.** The cookie dance is boilerplate dictated by `@supabase/ssr`
  and has churned essentially never. The cost of a new workspace package (deps, typecheck wiring,
  version coordination) exceeds the duplication it removes.

**Consequences.** If `@supabase/ssr`'s middleware contract changes, both files must be updated by
hand, acceptable at two call sites. Revisit only if a **third** app appears *and* all three still
share the same session mechanism (the staff console's planned SSO swap would remove that premise
anyway).

**Rejected.** A shared `createSupabaseMiddleware(guard)` factory (couples trust boundaries and
deployments to save boilerplate); moving the middleware helpers into `packages/db` (it stays
dependency-light and importable anywhere per ADR-0003, Next/`@supabase/ssr` deps don't belong there).
