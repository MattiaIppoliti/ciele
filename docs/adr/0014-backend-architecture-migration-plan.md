# Backend architecture hardening migration plan

## Status

Accepted.

## Context

The Wayfinder map for target backend architecture is now decided. The closed
decision records are:

- ADR-0007: retire Subscription Provider Connections and add Federated
  credentials.
- ADR-0008: durable job layer uses a Supabase job ledger plus Vercel Cron.
- ADR-0009: binary assets and knowledge originals use Supabase Storage.
- ADR-0010: Insights analytics move to Supabase SQL reporting and job-backed
  exports.
- ADR-0011: AI observability uses OpenTelemetry-shaped instrumentation plus
  Supabase `runtime_events`.
- ADR-0012: website scraping uses a hybrid local crawler plus Apify escalation.
- ADR-0013: pilot baseline is Vercel Pro + Supabase Free + free/BYOK optional
  services, about $20/month before LLM/provider tokens.

This ADR records the ordered execution plan. It does not choose new services.

## Decision

Execute the hardening work in small migration slices that preserve the current
widget/runtime behavior while moving shared foundations first.

The order is:

1. Provider-connection cleanup and federated credentials.
2. Storage foundation for public assets.
3. Durable job ledger and ingestion retry.
4. Runtime observability.
5. SQL Insights aggregates.
6. Hybrid crawler policy and scheduled recrawl.
7. Storage follow-ons for logos/profile images and knowledge originals.
8. Job-backed report exports.
9. Job failure Alerts.
10. Retention/cost guardrails and parent issue cleanup.

## Migration Steps

### 1. Finish Provider Connections

Scope:

- Keep `platform` and `api_key` behavior intact.
- Ensure `subscription` cannot be created or resolved.
- Keep Google Vertex federated runtime and follow-up Anthropic WIF/Azure OpenAI
  domain shapes on the same resolver seam.
- Close the provider parent issue once all child slices are verified.

Rollback:

- Resolver changes are code-only unless a migration has removed rows. Roll back
  by reverting the resolver/UI commits; legacy subscription rows remain ignored
  by default.

### 2. Establish Supabase Storage for Assistant Avatars

Scope:

- Add `public-assets` bucket/policies and a server-side storage helper.
- Move Assistant avatar upload from base64 data URL to object upload under
  `org/{organizationId}/avatars/assistant/{random}.{ext}`.
- Keep existing base64 avatar values readable during rollout.
- Add a migration/backfill path for existing assistant base64 avatars.
- Reduce or document the remaining Server Action body-size limit.

Rollback:

- Keep old `avatarUrl` rendering path valid. If storage upload fails in
  production, disable the storage upload action and keep existing image values.

### 3. Add Durable Job Ledger for Ingestion

Scope:

- Add `background_jobs` with kind, status, attempts, next-run time, lock/claim
  fields, payload, and error fields.
- Change file/text/url ingestion actions to create durable jobs; `after()`
  becomes acceleration only.
- Add retry action in Knowledge UI.
- Add stale-job sweep that marks permanently stuck work as error.

Rollback:

- Because Source status remains the user-facing state, rollback can restore the
  direct `after()` enqueue path while leaving unused job rows in place.

### 4. Add Runtime Events and Telemetry

Scope:

- Add `runtime_events` with 30-day detail retention design.
- Emit fire-safe chat turn, provider, tool/retrieval, ingestion job, and cron
  sweep events through the runtime/job seam.
- Do not store prompts, retrieved chunks, outputs, secrets, or direct personal
  contact data.
- Optional Langfuse/Sentry integrations remain environment-gated and sampled.

Rollback:

- Telemetry writes must be best-effort. Disable emission with an environment
  flag or no-op sink without affecting chat or jobs.

### 5. Move Insights Overview to SQL Aggregates

Scope:

- Add org-scoped reporting views/functions for conversation facts, message
  facts, and daily rollups.
- Add supporting indexes for conversation/message time and feedback access.
- Change Insights page to fetch bounded aggregate results, not all history.
- Keep current pure KPI functions as parity-test oracle.

Rollback:

- Keep the old in-memory KPI path behind an adapter until SQL parity is proven.
  Revert the page data loader to the old Db methods if needed.

### 6. Implement Hybrid Crawler Policy and Scheduled Recrawl

Scope:

- Add pure `chooseCrawler(config, env): "local" | "apify"`.
- Harden local crawler with total deadline and explicit local/apify telemetry.
- Make manual and scheduled recrawls use the same policy.
- Add due-source sweep for `daily`/`weekly`/`monthly`/`never`.
- Ensure double sweep does not double-crawl and processing sources are skipped.

Rollback:

- Revert `chooseCrawler` to Apify-when-token-present if local crawl causes
  regressions. Existing `crawlRunId` state remains compatible.

### 7. Finish Storage Follow-Ups

Scope:

- Move Organization logos and Member profile avatars to the shared public asset
  helper and migrate existing base64 values.
- Add `knowledge-originals` private bucket/policies.
- Store uploaded file originals before extraction with path, MIME, size, and
  checksum in Source config.
- Add re-process action for Sources with stored originals.

Rollback:

- Image rendering keeps old base64 URLs valid.
- Knowledge Sources without stored originals already need a clear unavailable
  state, so rollback can hide re-process while preserving uploaded object rows.

### 8. Add Job-Backed Insights Exports

Scope:

- Add export request table/job type and an Exports list UI.
- Generate large exports through the durable job runner.
- Store export artifacts in private Storage and serve signed URLs.
- Reuse SQL reporting views/functions from Step 5.

Rollback:

- Hide the Exports page action and keep the existing browser download for small
  ad hoc exports.

### 9. Expand Alerts for Job Failures

Scope:

- Raise deduped Alerts for failed ingestion and job-layer failures.
- Auto-resolve Alerts when retry succeeds.
- Keep crawl-failure Alert semantics as the pattern.
- Ensure sidebar badge counts include new producers.

Rollback:

- Alert producers are side effects. Disable the producer while leaving Source
  error status and runtime telemetry intact.

### 10. Retention and Guardrails

Scope:

- Add retention jobs or documented pruning for `runtime_events`, export files,
  and old job rows.
- Add dashboard/report checks for Supabase DB size, Storage, egress, Apify
  usage credit, and Vercel function duration.
- Revisit raw conversation retention as a product/legal decision.

Rollback:

- Retention jobs must be conservative and reversible where possible. Start with
  dry-run/report-only mode before deleting detail rows or files.

## Execution Dependencies

- Assistant avatars come before logos/profile images and knowledge-original
  storage because they establish the storage helper and bucket policies.
- Durable ingestion should precede job failure Alerts and knowledge-file
  reprocessing.
- SQL Insights should precede async exports.
- Runtime telemetry should precede broad Alert/job diagnostics.
- Hybrid crawler policy should precede due-recrawl automation so scheduled
  recrawls use the same manual policy.

## Verification Strategy

- Runtime capability changes go through `packages/agent/src/index.ts` and
  the locked interface test.
- Db shape changes update both Supabase and mock Db contract tests.
- Storage helpers get unit tests around path generation, allowed MIME/size, and
  tenancy assumptions; Supabase policies are migration-reviewed.
- Insights SQL gets parity tests against existing pure KPI functions.
- Job and cron behavior gets idempotency tests with a stubbed clock/db.
- Full validation before each push: `tsc --noEmit` and Vitest for
  `@agent-hub/db` and `@agent-hub/web`.

## Consequences

- The migration starts with shared foundations, so later slices reuse helpers
  instead of re-solving storage, jobs, or telemetry.
- Every paid-service upgrade remains tied to ADR-0013 triggers.
- No workload moves off Vercel/Supabase/Apify without measured evidence.
- The map phase is complete; remaining open issues are implementation slices,
  not architecture decisions.
