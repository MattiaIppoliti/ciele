# Scraping layer: hybrid local crawler plus Apify escalation

## Status

Accepted.

## Context

Ciele already has two website-crawl paths:

- `apps/web/src/lib/runtime/apify.ts` starts the Apify Website Content Crawler
  asynchronously and later reads the finished dataset.
- `apps/web/src/lib/runtime/local-crawl.ts` is a same-origin `fetch` + cheerio
  crawler used only when `APIFY_API_TOKEN` is not configured.

The current selection is environmental rather than product-shaped: if the token
exists, every website crawl goes to Apify; if not, every website crawl uses the
local fallback. Recurring re-crawl schedules make that choice cost-sensitive.

Primary-source facts:

- Apify Website Content Crawler is maintained by Apify, supports Markdown/text
  extraction, JavaScript-enabled sites through headless Firefox, file downloads,
  cookies/login flows, and anti-scraping protections/proxies. Source:
  https://apify.com/apify/website-content-crawler
- Apify pricing charges platform usage by compute unit; one CU is 1 GB RAM for
  one hour, and Free/Starter CU price is $0.20. Source:
  https://apify.com/pricing
- The current code starts the actor with `memory=4096`, so a one-hour run costs
  4 CU, or about $0.80 before proxy/storage/API-operation extras. A 10-minute
  4 GB run is about $0.13.
- Apify's docs say assigning more than 4096 MB to a typical Node actor does not
  add CPU unless the actor uses external binaries such as Chrome/Playwright.
  Source: https://docs.apify.com/actors/running/usage-and-resources
- Apify Free/Starter default runtime limits allow 16 GB max actor memory and 25
  concurrent runs; schedules/tasks also have generous platform limits for this
  pilot. Source: https://docs.apify.com/limits
- Vercel Hobby functions can run up to 300 seconds; Pro defaults to 300 seconds
  and can be configured higher. Source:
  https://vercel.com/docs/functions/limitations
- Vercel Cron is available on all plans. Hobby allows 100 cron jobs but only a
  once-per-day minimum interval with per-hour precision; Pro supports once per
  minute. Source: https://vercel.com/docs/cron-jobs/usage-and-pricing

Pilot cost shape:

- 5 daily 50-page crawls, if each Apify run takes 10 minutes at 4 GB, costs
  about `5 * 30 * 0.13 = $19.50/month` before extras.
- The same 5 sites weekly cost about `$2.80/month`.
- A mostly-static local crawl costs no Apify compute, but it runs inside the
  Vercel function budget and must stay bounded by page count, per-page timeout,
  and total wall-clock time.

## Decision

Use a hybrid crawler policy.

Make the built-in local crawler the first choice for small, static, same-origin
HTML sites:

- no `waitSecs`;
- no `fetchFiles`;
- no cookies/authenticated crawl;
- no proxy/anti-bot need;
- `maxPages <= 30`;
- total crawl deadline comfortably under Vercel's 300-second Hobby limit.

Use Apify when the crawl needs capabilities local fetch+cheerio should not own:

- JavaScript-rendered content (`waitSecs` or future explicit JS mode);
- file downloads;
- larger page budgets;
- known anti-scraping/proxy/fingerprinting needs;
- authenticated/cookie-based crawls;
- repeated local failures or empty local extraction where the admin explicitly
  retries with the cloud crawler.

This changes Apify from "production default whenever configured" to "cloud
escalation path for hard crawls." Apify remains in the stack because it is the
right managed service for browser/proxy/file-download crawling and keeps long
crawls out of Vercel request lifetimes.

Apify should be optional platform metered usage or tenant BYOK until measured
usage justifies a paid platform plan. It must not be mandatory baseline
infrastructure while the target budget is below EUR25/month.

## Implementation Shape

Replace the current environment-only branch in `beginWebsiteCrawl` with an
explicit crawl-policy helper, for example:

- `chooseCrawler(source.config, env): "local" | "apify"`;
- `local` writes `crawlRunId: "local"` and is finalized by the same
  `finalizeWebsiteCrawl` path;
- `apify` starts the actor as today and persists run/dataset ids.

The helper should be pure and unit-tested. Existing tests already cover Apify
input mapping, local HTML extraction, and the Apify finalize state machine; add
tests for the crawler selection policy and for the local branch of
`finalizeWebsiteCrawl`.

Harden `localCrawl` before making it primary:

- add a total deadline, not only per-page timeouts;
- keep the page cap at 30 unless measurements prove Vercel headroom;
- keep same-origin-only traversal;
- keep file types out of the local path;
- record whether a crawl used `local` or `apify` in Source config or telemetry.
- escalate or warn when local crawl p95 approaches 240 seconds, leaving too
  little margin under Vercel's 300-second Hobby limit.

The scheduled re-crawl sweep should call the same policy as manual crawl. A
site that previously needed Apify must keep using Apify on schedule unless the
admin changes its crawl settings.

## Rejected Options

- **Apify for every production crawl**: reliable, but daily pilot re-crawls can
  consume almost the whole <EUR25 infra budget before Supabase/Vercel overhead.
- **Local crawler only**: cheap, but cannot handle JS-rendered content, files,
  authenticated crawling, or anti-scraping cases that Apify already covers.
- **A new crawler service on Cloud Run now**: flexible, but adds GCP operational
  surface before the Vercel/Supabase/Apify stack has proven insufficient.

## Consequences

- Static institutional sites can refresh cheaply on the existing Vercel/Supabase
  footprint.
- Hard crawls still use a purpose-built managed service instead of stretching
  Vercel functions.
- The product needs visible crawl-mode/status copy so admins understand why a
  site used local vs cloud crawling.
- The cost-and-tier ticket can model Apify as variable usage driven by hard
  crawl volume, not as a fixed cost for every scheduled site.
