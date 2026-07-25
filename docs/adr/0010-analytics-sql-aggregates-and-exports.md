# Analytics at scale: SQL aggregates plus job-backed exports

## Status

Accepted.

## Context

Insights currently loads all org conversations, all trimmed org messages,
assistants, and website channels into the admin page, then computes filters,
KPIs, and chart series in client-side JavaScript. This is simple and useful for
the demo path, but it scales with the number of rows fetched rather than the
number of metrics displayed.

The repository already has a precedent for database-side analytics:
`supabase/migrations/0017_platform_admin_stats.sql` exposes platform-admin
views for cross-org totals and daily usage. Supabase/Postgres is also the
chosen data plane for the 1-5 organization horizon, and Supabase documents
indexes as the normal way to avoid full-table scans. Postgres materialized
views are available when a view/query becomes too slow and a stale-enough
dashboard is acceptable.

Sources:

- Supabase table and materialized-view guidance:
  https://supabase.com/docs/guides/database/tables
- Supabase Postgres index guidance:
  https://supabase.com/docs/guides/database/postgres/indexes
- PostgreSQL materialized views:
  https://www.postgresql.org/docs/current/rules-materializedviews.html
- PostgreSQL `REFRESH MATERIALIZED VIEW`:
  https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html

## Decision

Move org Insights reads to a SQL reporting layer in Supabase.

The first implementation should add org-scoped reporting views/functions for:

- conversation facts: org, assistant, created day, launch host, user role,
  language, escalated flag, subject key, aggregate feedback;
- message facts: org, conversation, created day, role, feedback;
- daily rollups for the dashboard time series and top-level KPI cards.

The admin UI should ask the server for bounded aggregate results by filter
instead of receiving all conversation/message rows. Keep the pure
`packages/db/src/insights.ts` functions as the TS oracle and parity check while
the SQL layer takes over. Parity is enforced by an in-process PGlite test that
runs the real `get_insights_overview` against that oracle over shared fixtures
(`packages/db/src/testing/insights.parity.test.ts`, PRD #270).

Use ordinary SQL views/functions first. Add materialized daily rollups only
when a measured dashboard query is slow enough to justify refresh lag. If
materialized rollups are introduced, refresh them through the durable job layer
from ADR-0008; the UI must tolerate stale analytics.

Add supporting indexes before changing the UI query shape:

- `conversations(assistant_id, created_at)`;
- `messages(conversation_id, created_at)`;
- `messages(conversation_id, role, feedback)`;
- existing assistant/org joins should remain indexed through primary and
  foreign keys.

Do not partition `conversations` or `messages` in the 1-5 organization horizon.
Revisit partitioning only after measured row growth makes retention or query
maintenance painful, roughly at multi-million message scale or when a single
org's Insights queries cannot stay under the target latency with indexes and
rollups.

## Exports

Insights exports should become durable jobs, not browser-only downloads.

1. A user requests an export with a filter snapshot, format, and scope.
2. The app creates an `analytics_export` job in the ADR-0008 job ledger.
3. The worker queries the same reporting layer used by the dashboard.
4. Small exports may stream directly from the request path; large or scheduled
   exports write a private object to Supabase Storage and expose a short-lived
   signed download URL.

Export artifacts need a private Storage bucket or prefix separate from public
widget assets. Export files must never be public URLs.

## Rejected Options

- **Keep in-memory KPIs indefinitely**: good for demos, but payload and query
  cost grow with history and make exports hard to schedule.
- **Add a warehouse now**: BigQuery/ClickHouse would solve future scale, but it
  violates the Vercel + Supabase first policy for the current org count.
- **Materialize every metric immediately**: premature; plain indexed SQL is
  simpler and fresher until measurements say otherwise.
- **Partition now**: operational complexity without evidence at this scale.

## Consequences

- Insights payload size becomes proportional to the visible dashboard, not raw
  conversation history.
- Exports reuse the durable job layer and the object-storage decision.
- The product keeps one analytics truth: Supabase/Postgres.
- Future retention/archive policy can be decided with measured row counts and
  query latency instead of guessing.
