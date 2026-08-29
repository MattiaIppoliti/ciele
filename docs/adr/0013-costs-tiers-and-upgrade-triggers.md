# Costs and tiers: pilot plan plus upgrade triggers

## Status

Accepted.

## Context

The backend architecture decisions now choose Vercel + Supabase first, with
Apify retained only as the hard-crawl escalation path, Supabase Storage for
binary objects, Supabase SQL for analytics, and Supabase `runtime_events` as the
retained observability store. The remaining question is which paid tiers are
allowed during the 1-5 organization pilot while staying under EUR25/month
excluding LLM/provider tokens.

Primary-source pricing facts, current on 2026-07-09:

- Vercel Hobby is $0/month, but is for personal/non-commercial use. It includes
  4 CPU-hours, 360 GB-hours of provisioned memory, and 1,000,000 function
  invocations per month. Vercel Pro is $20/month and includes $20 of usage
  credit. Sources:
  https://vercel.com/docs/plans/hobby and https://vercel.com/pricing
- Vercel Cron is included on all plans. Hobby can run cron jobs only once per
  day with per-hour precision; Pro supports once-per-minute schedules. Cron
  invokes Vercel Functions, so function usage and limits still apply. Source:
  https://vercel.com/docs/cron-jobs/usage-and-pricing
- Supabase Free includes 500 MB database size per project, 5 GB uncached egress
  plus 5 GB cached egress, 50,000 MAU, 1 GB Storage, 500,000 Edge Function
  invocations, 2M Realtime messages, and 200 peak Realtime connections.
  Supabase Pro/Team include 8 GB disk, 250 GB uncached plus 250 GB cached
  egress, 100,000 MAU, and 100 GB Storage before overage. Source:
  https://supabase.com/docs/guides/platform/billing-on-supabase
- Supabase Free projects enter read-only mode when database size exceeds
  500 MB. Pro disks auto-scale from the included 8 GB and bill overage at
  $0.125/GB-month for gp3 disk. Sources:
  https://supabase.com/docs/guides/platform/database-size and
  https://supabase.com/docs/guides/platform/manage-your-usage/disk-size
- Supabase Storage overage is $0.0213/GB-month after the plan quota; Free quota
  is 1 GB, Pro/Team quota is 100 GB. Source:
  https://supabase.com/docs/guides/storage/pricing
- Supabase egress overage is $0.09/GB uncached and $0.03/GB cached after quota.
  Source:
  https://supabase.com/docs/guides/platform/manage-your-usage/egress
- Apify Free is $0/month with $5 monthly usage credit and $0.20 per compute
  unit. Starter is $29/month plus pay-as-you-go and includes $29 usage credit.
  One CU is 1 GB RAM for one hour; residential proxy traffic is $8/GB on
  Free/Starter. Source: https://apify.com/pricing
- Langfuse Cloud Hobby is free with 50k units/month and 30 days data access.
  Core is $29/month. Source: https://langfuse.com/pricing
- Sentry Developer is free for one user and includes a small error/spans/logs
  allowance; Team starts at $26/month when billed annually. Sources:
  https://sentry.io/pricing/ and https://docs.sentry.io/pricing/
- GitHub Free includes private repositories plus 2,000 Actions minutes/month
  for private repositories on Free accounts/organizations. Sources:
  https://github.com/pricing and
  https://docs.github.com/en/billing/reference/product-usage-included

## Decision

Use this pilot baseline:

| Service | Pilot tier | Monthly base | Why |
| --- | ---: | ---: | --- |
| Vercel | **Pro** for any commercial production pilot; Hobby only for personal demo/dev | $20 | Commercial use, spend controls, team workflow, and room for production traffic while staying below budget. |
| Supabase | **Free** | $0 | The 1-5 org pilot should fit under 500 MB DB, 1 GB Storage, and 10 GB total Free egress if object sizes and telemetry retention stay bounded. |
| Apify | **Free** platform credit or tenant BYOK | $0 platform base | ADR-0012 makes Apify an escalation path, not baseline infra. Static/small sites use local crawling. |
| Langfuse | **Cloud Hobby**, optional and sampled | $0 | Supabase `runtime_events` is the retained source of truth; Langfuse is a free trace viewer only. |
| Sentry/other observability | none required; Sentry Developer allowed if useful | $0 | Error monitoring may be helpful, but it is not the decided LLM observability store. |
| GitHub | **Free** | $0 | Repo/CI stays on the existing GitHub surface until private CI minutes or governance needs say otherwise. |
| GCP/Azure/Anthropic enterprise auth | tenant-billed only | $0 platform infra | Federated credentials authenticate tenant-billed APIs; LLM tokens are excluded from this budget. |

The baseline platform bill is therefore about **$20/month** for a commercial
pilot, plus LLM/provider tokens. For a personal non-commercial demo, the same
architecture can run at **$0/month** on Vercel Hobby + Supabase Free + Apify
Free + Langfuse Hobby.

If Supabase must move to Pro while Vercel is also on Pro, the platform base
becomes at least **$45/month** before usage overage. That exceeds the EUR25
target and must be treated as an explicit budget increase, not an automatic
upgrade.

## 1-Org and 5-Org Projection

Assumptions:

- one shared Vercel project and one shared Supabase project;
- static/small website crawls use the local crawler;
- only hard crawls consume Apify;
- avatars/logos/source originals remain small and bounded;
- runtime event detail retention starts at 30 days with daily rollups.

| Scenario | Vercel | Supabase | Apify | Langfuse | Monthly platform base |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 org, personal demo | $0 Hobby | $0 Free | $0 Free/BYOK | $0 Hobby | $0 |
| 1 org, commercial pilot | $20 Pro | $0 Free | $0 Free/BYOK | $0 Hobby | $20 |
| 5 orgs, static/local crawls | $20 Pro | $0 Free | $0 Free/BYOK | $0 Hobby | $20 |
| 5 orgs, frequent JS/blocked crawls | $20 Pro | $0 Free | variable; use Free credit first | $0 Hobby | $20 + Apify over credit |
| Supabase Pro required | $20 Pro | $25+ Pro | variable | $0 Hobby | $45+ |

## Upgrade Triggers

### Vercel

Start commercial pilots on Pro. Hobby is allowed only for personal demo/dev.

Upgrade beyond the current Vercel setup or extract a worker when:

- cron must run more often than once per day and the project is still on Hobby;
- cron/finalize/recrawl batches regularly approach the 300-second function
  duration;
- chat/widget traffic competes with background crawling or ingestion;
- spend controls or team access are required and the project is still on Hobby;
- a workload needs a runtime longer than Pro's configured function ceiling.

### Supabase

Stay Free until one of these is true:

- database size reaches 350-400 MB or read-only risk becomes credible;
- Storage reaches 700-800 MB, especially after original knowledge files land;
- egress reaches 4 GB/month on Free. Although Storage docs separate cached and
  uncached bandwidth, plan against the conservative 5 GB billing-doc quota;
- production needs daily backups, support, SSO, or a contractual reliability
  posture unavailable on Free;
- analytics/runtime-event tables need more retention than the 30-day detail
  window plus rollups can support under the Free DB limit.

Move to Supabase Pro only with a budget decision, because Vercel Pro +
Supabase Pro exceeds the target.

### Apify

Stay on Free/BYOK while ADR-0012 keeps static crawls local.

Upgrade or require tenant BYOK when:

- Apify usage consumes the $5 monthly Free credit for two consecutive months;
- daily JS/browser crawls across pilot orgs exceed the measured free-credit
  envelope;
- a customer needs residential proxies, authenticated/cookie crawling,
  file-heavy crawling, or higher crawler concurrency;
- operational support for hard crawls is worth the $29/month Starter floor.

### Langfuse

Use Cloud Hobby only as an optional sampled trace viewer.

Do not upgrade to Core automatically. Upgrade only when:

- the team explicitly wants more than 50k units/month or more than 30 days of
  trace access outside Supabase rollups;
- the budget target is revised above EUR25/month;
- external trace exploration becomes more valuable than keeping all telemetry
  in Supabase.

### Sentry

Do not make Sentry a required service for the pilot. Use the free Developer plan
only if it materially improves exception triage.

Upgrade only when:

- more than one operator needs Sentry access;
- free error/span/log quotas are repeatedly exhausted after sampling/noise
  filters;
- third-party integrations or team workflow become operationally necessary.

### GitHub

Stay on GitHub Free.

Upgrade only when:

- private CI exceeds the included Actions minutes;
- paid team controls or enterprise governance become necessary;
- package/artifact storage becomes a real bottleneck.

### Supabase Runtime Events

Keep detailed `runtime_events` rows for 30 days first, then roll up and prune.

Reduce retention or sampling before upgrading storage/database:

- if `runtime_events` grows faster than expected;
- if event writes affect chat latency;
- if Langfuse and Supabase telemetry duplicate too much data.

## Rejected Options

- **Vercel Hobby for commercial production**: cheaper, but Vercel documents
  Hobby as personal/non-commercial.
- **Supabase Pro as default pilot baseline**: useful for production backups and
  larger DB/storage quotas, but it breaks the EUR25 target when paired with
  Vercel Pro.
- **Apify Starter as default**: the $29 floor breaks the budget and ADR-0012
  makes Apify usage conditional.
- **Langfuse Core as default**: good trace UX, but $29/month duplicates the
  Supabase telemetry decision and breaks the budget.
- **Sentry Team as default**: useful app monitoring, but not required for the
  decided observability path and starts above the remaining pilot budget.
- **New GCP worker/queue now**: no workload has yet proven Vercel/Supabase/Apify
  insufficient.

## Consequences

- The pilot can stay under budget only by keeping Supabase and Apify on Free
  tiers and treating LLM/provider usage as separate tenant/platform cost.
- The first serious production reliability upgrade is likely Supabase Pro, and
  it requires an explicit budget change.
- Upgrade triggers are measurable: DB size, Storage size, egress, cron cadence,
  function duration, Apify usage credit, and telemetry volume.
- The final migration plan must preserve these guardrails: every new table,
  bucket, job, and event stream needs a retention or quota story.
