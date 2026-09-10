# Admin performance acceptance

Three kinds of check, with different teeth. The bundle budgets fail the build.
The latency and interaction probes are manual scripts: `check:admin-perf` runs
them against a local production build in mock mode with one command, and the
same two scripts take a staging URL and a Member cookie. A mock database
measures the app, not the deployment, so local numbers are a regression
baseline and staging is the authority for real RLS, data volume, network
distance and cold functions.

## Budgets

| Workload | Budget | Where it is checked |
|---|---:|---|
| Shared admin shell | 300 KB gzip or less | `next build` (`scripts/check-admin-bundle.mjs`), fails CI |
| Inbox route increment | 50 KB gzip or less | same |
| Improvements route increment | 35 KB gzip or less | same |
| Insights route increment | 50 KB gzip or less | same |
| New/Edit Flow route increment | 80 KB gzip or less each | same |
| Admin route document | cold 1,000 ms or less; warm p50 150 ms, p95 300 ms | `check:admin-latency`, manual |
| Cold Insights document | 1,000 ms or less after the cache is expired | `check:admin-latency`, manual |
| Simple mutation, click to visible result | p50 250 ms, p95 600 ms | `check:admin-interactions`, manual |
| Client navigation, click to visible route | cold 1,000 ms or less; warm p50 150 ms, p95 300 ms | `check:admin-interactions`, manual |

The 150 ms median is the threshold under which a click reads as immediate;
the 300 ms p95 rejects a route that is fine on average and stalls one time in
twenty. The one-second cold ceiling keeps a cold Insights load, which runs the
30-day aggregate, inside something a person waits for without reloading.

## What the app does to meet them

- The admin layout (`apps/web/src/app/(admin)/layout.tsx`) is not async. The
  static frame renders at once and the sidebar, top bar, activation banner and
  notification centre each await their reads inside their own `<Suspense>`
  boundary, so the slowest shell query never holds the page.
- Every route has its own `loading.tsx` (`src/lib/loading-coverage.test.ts`
  fails the `test` task when one is missing), so a navigation paints the destination
  skeleton while the page's server component runs. Inbox, Improvements and
  Insights carry hand-drawn skeletons that mirror their layout.
- Transcript-only Inbox UI (markdown with syntax highlighting, citations,
  thinking panel), the Inbox date-picker calendar (react-day-picker, about
  5 KB gzip, imported through `@agent-hub/ui/calendar` because a dynamic import
  of the barrel defers nothing) and the Improvements drawer and Kanban are
  `next/dynamic` splits, so the list views do not pay for them. Only the
  Kanban and the calendar are `ssr: false`: native drag-and-drop has no server
  half, and a popover is never open on the server.
- Mutations revalidate by path from inside the Server Action, synchronously,
  so the action response carries the refreshed tree back and the client stops
  calling `router.refresh()` (ADR-0005). The profile save keeps its fields
  editable while pending and shows the pending state on the button alone.
- The Insights overview is cached for five minutes per (Organization, filter)
  and expired by any console mutation the aggregate reads (ADR-0005 as
  amended). Widget traffic does not expire it and shows up when the entry
  ages out, within five minutes.
- The Improvements board pages each lane by its own cursor with a server count
  per lane, so a lane with 400 Done items costs one page of it and an old
  In-Progress item is never hidden behind newer rows in other lanes. The
  search, priority and assignee filters run over the loaded rows only, and a
  filtered lane count is the matches among them; the empty state says so, and
  an export applies the same filters to the whole lane read from the server.
- The Library read runs filtering, totals, paging and page-scoped Concept
  counts in one RLS-preserving SQL call (`get_org_knowledge_source_page`). Tab
  navigation requests only totals with `pageSize: 0`. Teammate Knowledge Scope
  pickers use a compact Source identity projection, so displaying a picker
  does not fetch FAQ bodies, Assistant links or per-Source Concept counts.
  Apply `20260909221722_knowledge_library_page_reads.sql` to enable the Library
  SQL path; an older database keeps the previous read during deployment.
- The Flow catalogue reads active, non-excluded FAQ titles through Assistant
  Knowledge Links, without scanning Collection bodies. Library and Flow
  pickers share the shell's request-local Assistant summaries.
- The Flow Builder loads the Canvas and Flows Agent only when selected, with
  loading feedback. The draft stays in the Builder across both renderings.
  On 2026-09-10, the production build's Flow route increment fell from
  268.9 KB to 63.6 KB gzip (76%). Both new and edit routes have an 80 KB budget.

## Run the probes

Install the browser once:

```sh
pnpm --filter @agent-hub/web exec playwright-core install chromium
```

Locally, in mock mode, both probes with 20 samples each (builds first; set
`ADMIN_PERF_SKIP_BUILD=1` to reuse an existing mock-mode `.next`):

```sh
pnpm --filter @agent-hub/web check:admin-perf
```

Against staging, as a signed-in Member. Keep the cookie in the environment;
the scripts never print it.

```sh
ADMIN_PERF_BASE_URL=https://staging.example.com \
ADMIN_PERF_COOKIE='your authenticated Cookie header' \
pnpm --filter @agent-hub/web check:admin-latency

ADMIN_PERF_BASE_URL=https://staging.example.com \
ADMIN_PERF_COOKIE='your authenticated Cookie header' \
pnpm --filter @agent-hub/web check:admin-interactions
```

`check-admin-latency.mjs` counts the first response for each route as cold and
reports nearest-rank p50 and p95 over the following samples. It fails on a
redirect or a non-2xx, so an expired session cannot pass as a fast login page.
Before the Insights route it sends `DELETE /api/insights`, which expires the
Organization's cached overview, so the cold sample is the real default 30-day
query rather than a cache hit.

`check-admin-interactions.mjs` clicks the sidebar links and times each until
the destination is visible, located by `data-testid` attributes the components
declare (`assistants-search`, `inbox-heading`, `improvements-heading`,
`insights-heading`, `profile-first-name`, `profile-save`, `profile-saved`); a
missing element fails with its name, not a selector. For
the mutation it appends a marker to the profile's first name, measures through
the real Server Action response and the visible `Saved` marker, then restores
the original name with a second confirmed action.

## Evidence

- Enforced in CI: the six bundle budgets, on every `next build`.
- Manual, reproducible: `check:admin-perf` prints local mock-mode numbers with
  20 samples per route and per mutation. Run it before and after a change to a
  shell component and compare. On 2026-09-02, on the reviewer's laptop against
  the production build `pnpm verify` had just made: documents cold 35 to 64 ms,
  warm p50 44 to 53 ms, p95 73 to 85 ms; browser navigation cold 290 to 983 ms
  (the first click of a session compiles nothing, it downloads the route's
  chunks), warm p50 80 to 86 ms, p95 84 to 112 ms; profile save p50 193 ms,
  p95 227 ms. That last figure is 160 ms more than the build that revalidated
  the layout in `after()`: the response now carries the re-rendered admin
  shell, which is what keeps the sidebar name current, and the budget was set
  for a click-to-visible result, not for an acknowledgement.
- Unknown until staging runs: real-data p50 and p95, mutation-visible latency
  with the synchronous layout revalidation, database saturation, cache hit
  rate, tenant skew. Nobody has run the probes against staging yet.
- On 2026-09-10, after the Library/Flow changes, an idle local production run
  passed all budgets with 20 samples: warm navigation p50 77–84 ms, p95
  81–108 ms; profile save p50 207 ms, p95 409 ms. An earlier run concurrent
  with the database suite missed the cold Insights and profile p95 budgets;
  run timing probes separately from builds and test suites. These mock-mode
  timings do not measure the new SQL read's production latency.
