# Website crawler providers — release & operations runbook

Operating guide for the Website Source crawler matrix: the three providers, how
one is chosen, the environment/config that makes each available, where to watch
it, how to diagnose each failure mode, and how to release and roll back.

Scope is the **application side** — provider selection, the shared crawl
lifecycle, and the operator-visible outcomes. The Crawl4AI *worker* (the pinned
container, its sizing, provisioning, and version upgrades) has its own runbook:
[`services/crawl4ai-worker/RUNBOOK.md`](../../services/crawl4ai-worker/RUNBOOK.md).

Domain terms follow `context.md`: Website Source, Source status, Concept,
Collection, crawl finalizer, org admin.

---

## 1. The provider matrix

A Website Source is crawled by exactly one of three providers. An org admin
picks **Automatic** (the default), **Local**, **Crawl4AI**, or **Apify** in the
Source's settings. The **resolved** provider is chosen once, when a crawl
starts, and persisted with the run — config or environment changes never reroute
an in-flight crawl.

| Provider | Runs where | Best for | Not for |
|----------|-----------|----------|---------|
| **Local** | In-process (Vercel function), no external service | Small, static, same-origin HTML within the local page cap | JavaScript-rendered pages, large crawls, file downloads, logins |
| **Crawl4AI** | Private pinned container worker (Chromium + Playwright) | JavaScript-rendered pages and larger bounded same-origin deep crawls | File downloads, login flows, managed proxy / anti-bot (reserved for Apify) |
| **Apify** | Apify Website Content Crawler (metered SaaS) | File downloads, login-protected sites, managed proxy / anti-bot, explicit managed crawls | Being the default for ordinary crawls (cost) |

Provider capabilities and availability live in
`apps/web/src/lib/runtime/website-crawlers.ts`; adapters in `apify.ts`,
`crawl4ai.ts`, `local-crawl.ts`; the shared lifecycle in `ingest.ts`.

### How Automatic resolves (pure policy)

`resolveWebsiteCrawlerProvider(configured, characteristics, capabilities)` —
unit-exhaustive in `website-crawlers.test.ts`:

1. An **explicit** choice (Local / Crawl4AI / Apify) is honored as-is. An
   explicitly chosen remote provider that the environment can't run is **not**
   silently rerouted: it starts, the adapter surfaces the missing-credentials
   error, and the Source lands in `error`.
2. **Automatic** (or a legacy Source with no configured provider) resolves by
   required capability, derived only from the Source's own config:
   - file download **or** login-protected → **Apify** (or an error if Apify is
     not configured);
   - browser-rendered (a JS wait is set) **or** larger than the local page cap →
     **Crawl4AI** if configured, else **Apify**, else an error;
   - otherwise (small, static, same-origin, within the cap) → **Local**.
3. Only Automatic can fail to resolve; the error is written to the Source so the
   missing capability is visible, never silent.

A failed run never auto-fails-over to another provider. An org admin's explicit
retry re-runs this policy and may resolve a different provider.

---

## 2. The one crawl lifecycle (initial = manual = scheduled)

All three entry points call the same two functions, so behavior is identical:

- **Initial crawl** — `beginWebsiteCrawl` when a Website Source is added.
- **Manual re-crawl** — `restartWebsiteCrawl` (clears the prior run identity, then `beginWebsiteCrawl`).
- **Scheduled re-crawl** — the `sweep-recrawls` cron claims due Sources and calls the same start op.

`beginWebsiteCrawl` validates the target, resolves + persists the provider, and
starts the async job, leaving the Source `processing`. It has three terminal
outcomes, and they are deliberately distinguishable (`CrawlStartResult`):

| Outcome | Source after | Where it shows |
|---|---|---|
| **started** | `processing`, run ids recorded | the Knowledge row's status badge |
| **refused** — a spend allowance said no (#510) | **unchanged**: previous status and Concepts kept, `config.crawlBlockedReason` set | an amber line on the Knowledge row + the plan-cap Alert |
| **failed** — bad target, no provider, adapter error | `error` with the message | the status badge |

A refusal is not a failure: nothing is wrong with the Source, so nothing about it
is downgraded, and a re-crawl refused after the scheduled sweep already claimed
it is returned to `ready` so the next sweep can claim it again. Only crawlers
that cost money are gated — a crawl resolved to the free in-process crawler is
never refused.

**Accounting is post-hoc, bounded by the page cap.** The allowance is checked
when a crawl *starts*, and the pages it fetched are metered when it *finishes*,
so a single crawl can overshoot the remaining budget by at most the Source's own
`maxPages`. Charging up front would mean either refusing legitimate crawls or
holding credits against an unknown page count, and neither is worth it at this
granularity. `finalizeWebsiteCrawl`
polls the stored run, and on success ingests one Concept per page, marks the
Source `ready`, and resolves any crawl Alert; on failure/empty it marks `error`
and raises a crawl Alert. Finalization is driven both by the client poll (open
Knowledge tab) and the `finalize-crawls` cron backstop.

**No-duplicate-Concepts guarantee.** Finalization is idempotent under a
renewable per-Source lease: the cron claims a bounded batch under its own worker
id; a concurrent client poll cannot take the lease and returns `processing`
without ingesting. Previous Concepts are replaced only after the new crawl
returns ≥1 usable page and the finalizer owns the lease, so a failed refresh
leaves the prior ready knowledge in place.

---

## 3. Environment & configuration

App-side env (server scope only — never `NEXT_PUBLIC_`). See
`apps/web/.env.example`.

| Var | Provider / purpose | Effect |
|-----|--------------------|--------|
| `APIFY_API_TOKEN` | Apify | When set, Apify is available (`isApifyConfigured()`) for explicit selection and Automatic fallback. |
| `CRAWL4AI_BASE_URL` | Crawl4AI worker URL | Both this **and** the token must be set for Crawl4AI to be available (`isCrawl4aiConfigured()`). |
| `CRAWL4AI_API_TOKEN` | Crawl4AI bearer token | Server-only; sent as `Authorization: Bearer`, never in the body, logs, Source config, client payloads, or telemetry. |
| `CRON_SECRET` | Cron auth | Required for `finalize-crawls` and `sweep-recrawls`; the routes refuse to run without it (503) and reject a wrong bearer (401). |

Local needs no credential and is always available. Crawl4AI worker-side config
(token generation, `SECRET_KEY`, hardened `config.yml`, sizing) is in the worker
runbook §2–§4.

Cron schedules (`vercel.json`): `finalize-crawls` daily `0 3 * * *` (closed-tab
backstop), `sweep-recrawls` daily `0 6 * * *` (due re-crawls). The client poll
covers the common tab-open case; tighten these on a paid plan if needed.

---

## 4. Release checklist

1. **Merge & migrate.** Ship on `main`; CI `apply-migrations.sh` applies any
   pending migrations by filename. No crawler-specific migration is required by
   this change.
2. **Apify (optional).** Confirm `APIFY_API_TOKEN` is set in the target
   environment if managed crawls are expected.
3. **Crawl4AI (optional).** Stand up / confirm the worker per the worker runbook
   §4, then set `CRAWL4AI_BASE_URL` + `CRAWL4AI_API_TOKEN` on the app. Confirm
   the worker health check and authenticated API via the worker smoke test
   (ops action — see §7 below). Automatic lights up on its own once both are set.
4. **Cron.** Confirm `CRON_SECRET` is set so the finalize/sweep backstops run.
5. **Smoke the matrix in staging** (§6 acceptance mapping): one static Source
   (Local → ready), one JS-rendered Source (Crawl4AI → ready), one managed
   Source (Apify → ready), one induced failure (Source `error` + crawl Alert).
6. **Watch** the monitoring points in §5 for the first day.

---

## 5. Monitoring

- **Source status** — the primary operator signal. `processing` → `ready` on
  success; `error` (with a sanitized message) on failure. Surfaced in the
  Knowledge UI per Source.
- **Alerts** (`/alerts`) — a crawl failure raises a `crawl` Alert keyed to the
  Source (`website-source:{id}`), deduped/refreshed on repeats and auto-resolved
  on the next success. Producer: `finalizeWebsiteCrawl` (see `ingest.ts`).
- **`runtime_events` telemetry** — one `crawl` event per terminal outcome:
  `crawlerProvider`, `status` (succeeded/failed), `pageCount`, `durationMs`,
  `traceId` (the worker task/run id), and a sanitized `errorClass`. Credentials
  are never present. Emitted from `finalizeWebsiteCrawl`.
- **Crawl4AI worker health/metrics** — `GET /health`, `GET /metrics`
  (task failure rate, queue depth, 401s, memory, p95 duration) and the smoke
  test. See worker runbook §5.

---

## 6. Troubleshooting — failure mode → user-visible state

Every branch produces a deterministic, observable outcome (covered by the tests
listed):

| Symptom / cause | User-visible state | Where covered |
|-----------------|--------------------|---------------|
| **Terminal remote failure** (worker/actor reports failed) | Source `error` with the sanitized reason; crawl Alert raised; `crawl` telemetry `failed`/`RemoteCrawlFailure`. | `ingest.provider-matrix.test.ts`, `ingest.crawl-telemetry.test.ts` |
| **Timeout / worker unreachable during polling** | Source `error`; crawl Alert raised; no Concepts ingested. | `ingest.provider-matrix.test.ts` |
| **Malformed response** (shapeless/failed page items, or a malformed status body) | Malformed page items are dropped; if nothing usable remains → `error` ("no usable pages"). A malformed *status* body defaults to running → stays `processing`. | `ingest.provider-matrix.test.ts`, `crawl4ai.test.ts` |
| **Empty result** (completed, zero usable pages) | Source `error` ("Crawl completed but returned no usable pages"); crawl Alert. Prior Concepts survive on a re-crawl. | `ingest.provider-matrix.test.ts`, `ingest.crawl-telemetry.test.ts`, `recrawl.scheduled.test.ts` |
| **Unavailable provider** — explicit choice, no credentials | Source `error` at start (adapter surfaces missing config); resolved provider still recorded as the explicit choice. | `ingest.provider-matrix.test.ts`, `ingest.provider.test.ts` |
| **Unavailable provider** — Automatic, no compatible provider | Source `error` with an actionable message; nothing started. | `ingest.provider-matrix.test.ts`, `website-crawlers.test.ts` |
| **Unsafe target** (non-HTTP, credentials-in-URL, loopback/private/link-local/metadata, private-resolving, redirect into a blocked network) | Source `error` before any provider is invoked; Local also revalidates redirects and pins DNS. | `ingest.security.test.ts`, `ingest.provider-matrix.test.ts` |
| **Still running** | Stays `processing`; the sweep re-checks on the next tick. | `ingest.provider-matrix.test.ts`, `ingest.crawl.test.ts` |
| **Concurrent client + cron finalize** | Ingested exactly once (lease holder wins); the other returns `processing`. | `ingest.provider-matrix.test.ts`, `ingest.provider.test.ts` |

First diagnostic steps:

1. Read the Source `error` text and the `/alerts` detail (both sanitized).
2. Check the `crawl` telemetry event for `crawlerProvider`, `errorClass`, and
   `pageCount` to see which provider ran and how it terminated.
3. For Crawl4AI specifically, check worker `/health`, `/metrics`, and logs
   (worker runbook §5) — 401s mean a token mismatch, queue-full 503s mean
   capacity, memory near threshold means a too-large crawl.

---

## 7. Docker / staging checks (ops actions)

These require live infrastructure and are **operator actions**, never run by
application code. Reference, do not automate here:

- **Worker health + authenticated API** — start the pinned image and run the
  worker smoke test: `services/crawl4ai-worker/scripts/smoke-test.sh` against the
  deployed URL with the bearer token (worker runbook §4 step 5, §5). It hits
  `GET /health`, submits a bounded crawl against a controlled fixture, and
  verifies a terminal result.
- **Local development** — `docker compose up -d` in `services/crawl4ai-worker/`,
  then point the app's `CRAWL4AI_BASE_URL`/`CRAWL4AI_API_TOKEN` at it.
- **Staging matrix crawl** — run the four staging smokes from §4 step 5 against a
  controlled static fixture, a JS-rendered fixture, an induced failure, and a
  concurrent-finalizer case.

---

## 8. Rollback

- **Disable Crawl4AI app-side** — unset `CRAWL4AI_BASE_URL` /
  `CRAWL4AI_API_TOKEN` on the app. Automatic then routes browser crawls to Apify
  (or errors if Apify is also absent); in-flight Crawl4AI runs still finalize
  under the provider they started with until terminal, and existing Apify/Local
  runs are unaffected.
- **Disable Apify app-side** — unset `APIFY_API_TOKEN`. Automatic stops choosing
  Apify; explicit-Apify Sources land in `error` until re-pointed.
- **Roll back the worker** — shift traffic to the last-good revision or restore
  the previous pinned digest (worker runbook §7). The app never fails an
  in-flight run over to another provider, so a worker rollback cannot corrupt
  finalization.
- **Roll back the app** — revert the deploy on Vercel. No schema change is tied
  to this feature, so no migration rollback is required; legacy Sources without a
  configured provider continue to behave as Automatic, and existing local/Apify
  run identifiers stay recognizable until their runs reach a terminal state.
