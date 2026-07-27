import type {
  ResolvedWebsiteCrawlerProvider,
  WebsiteCrawlerProvider,
  WebsiteSourceConfig,
} from "@agent-hub/core";
import {
  fetchCrawledPages,
  getRunState,
  isApifyConfigured,
  isRunSuccess,
  isRunTerminal,
  startCrawl,
  type CrawledPage,
  type CrawlOptions,
  type StartedCrawl,
} from "./apify";
import { LOCAL_CRAWL_MAX_PAGES, LOCAL_CRAWL_RUN, localCrawl } from "./local-crawl";
import {
  getCrawl4aiTask,
  isCrawl4aiConfigured,
  isCrawl4aiSuccess,
  isCrawl4aiTerminal,
  mapCrawl4aiPages,
  startCrawl4ai,
} from "./crawl4ai";

export type WebsiteCrawlPollResult =
  | { status: "processing" }
  | { status: "failed"; message: string }
  | { status: "succeeded"; pages: CrawledPage[] };

export interface WebsiteCrawlerAdapter {
  start(url: string, options: CrawlOptions): Promise<StartedCrawl>;
  poll(input: {
    runId: string;
    datasetId: string;
    url: string;
    options: CrawlOptions;
  }): Promise<WebsiteCrawlPollResult>;
}

const localAdapter: WebsiteCrawlerAdapter = {
  async start() {
    return { runId: LOCAL_CRAWL_RUN, datasetId: LOCAL_CRAWL_RUN };
  },
  async poll({ url, options }) {
    return { status: "succeeded", pages: await localCrawl(url, options) };
  },
};

const apifyAdapter: WebsiteCrawlerAdapter = {
  start: startCrawl,
  async poll({ runId, datasetId, url }) {
    const run = await getRunState(runId);
    if (!isRunTerminal(run.status)) return { status: "processing" };
    if (!isRunSuccess(run.status)) {
      return { status: "failed", message: `Crawl ${run.status.toLowerCase()}` };
    }
    return {
      status: "succeeded",
      pages: await fetchCrawledPages(run.datasetId || datasetId, url),
    };
  },
};

const crawl4aiAdapter: WebsiteCrawlerAdapter = {
  start: startCrawl4ai,
  async poll({ runId, url }) {
    const task = await getCrawl4aiTask(runId);
    if (!isCrawl4aiTerminal(task.status)) return { status: "processing" };
    if (!isCrawl4aiSuccess(task.status)) {
      return {
        status: "failed",
        message: task.error
          ? `Crawl failed: ${task.error}`
          : `Crawl ${task.status.toLowerCase()}`,
      };
    }
    return { status: "succeeded", pages: mapCrawl4aiPages(task.results, url) };
  },
};

const adapters: Record<ResolvedWebsiteCrawlerProvider, WebsiteCrawlerAdapter> = {
  local: localAdapter,
  apify: apifyAdapter,
  crawl4ai: crawl4aiAdapter,
};

export interface WebsiteCrawlerCapabilities {
  apifyConfigured: boolean;
  crawl4aiConfigured: boolean;
}

/**
 * The crawl traits the Automatic policy routes on. Every trait is derived from
 * a Website Source's own config (never invented) — see
 * `crawlCharacteristicsFromConfig`.
 */
export interface WebsiteCrawlCharacteristics {
  /** Download + parse linked files during the crawl — an Apify-only capability. */
  fetchFiles: boolean;
  /** Crawl behind a login flow — an Apify-only capability. */
  loginProtected: boolean;
  /** Extra settle time for JS-rendered pages → needs a real browser. */
  browserRendered: boolean;
  /** Requested page budget exceeds what the in-process local crawler caps at. */
  exceedsLocalCap: boolean;
}

/** A resolved provider, or the reason no configured provider can serve the crawl. */
export type WebsiteCrawlerResolution =
  | { provider: ResolvedWebsiteCrawlerProvider }
  | { error: string };

/** Projects a Source's stored config onto the traits the policy branches on. */
export function crawlCharacteristicsFromConfig(
  config: WebsiteSourceConfig
): WebsiteCrawlCharacteristics {
  return {
    fetchFiles: Boolean(config.fetchFiles),
    loginProtected: Boolean(config.loginProtected),
    browserRendered: (config.waitSecs ?? 0) > 0,
    exceedsLocalCap: (config.maxPages ?? 0) > LOCAL_CRAWL_MAX_PAGES,
  };
}

/**
 * The Automatic crawler routing policy — a pure function of (configured choice,
 * crawl characteristics, environment capabilities) so every selection branch is
 * exhaustively unit-testable off the network.
 *
 * Explicit choices are honored as-is (the resolved provider is recorded before
 * work starts): Local always runs in-process; an explicitly chosen remote
 * provider the environment can't run is *not* silently rerouted — it starts on
 * that provider and the adapter surfaces the missing-credentials error, landing
 * the Source in `error`.
 *
 * Automatic (or a legacy Source with no configured provider) resolves once, at
 * crawl start:
 *  - file-download or login-protected crawls are reserved for Apify;
 *  - browser-rendered or larger-than-local crawls prefer Crawl4AI, then fall
 *    back to the managed browser crawler (Apify);
 *  - everything else — a small, static, same-origin crawl within the local cap
 *    — uses the always-available in-process crawler.
 * Only Automatic can fail to resolve: when no configured provider can serve the
 * required capability the caller gets a clear error to surface on the Source.
 */
export function resolveWebsiteCrawlerProvider(
  configured: WebsiteCrawlerProvider | undefined,
  characteristics: WebsiteCrawlCharacteristics,
  capabilities: WebsiteCrawlerCapabilities
): WebsiteCrawlerResolution {
  if (
    configured === "local" ||
    configured === "apify" ||
    configured === "crawl4ai"
  ) {
    return { provider: configured };
  }

  // Automatic — resolve by required capability.
  if (characteristics.fetchFiles || characteristics.loginProtected) {
    return capabilities.apifyConfigured
      ? { provider: "apify" }
      : { error: NO_MANAGED_PROVIDER };
  }
  if (characteristics.browserRendered || characteristics.exceedsLocalCap) {
    if (capabilities.crawl4aiConfigured) return { provider: "crawl4ai" };
    if (capabilities.apifyConfigured) return { provider: "apify" };
    return { error: NO_BROWSER_PROVIDER };
  }
  return { provider: "local" };
}

const NO_MANAGED_PROVIDER =
  "This crawl needs file downloads or login handling, which only the managed crawler (Apify) supports, but no Apify API token is configured.";

const NO_BROWSER_PROVIDER =
  "This crawl needs a browser-rendered or larger crawl, but neither Crawl4AI nor Apify is configured.";

export function websiteCrawlerCapabilities(): WebsiteCrawlerCapabilities {
  return {
    apifyConfigured: isApifyConfigured(),
    crawl4aiConfigured: isCrawl4aiConfigured(),
  };
}

/**
 * Whether a finished *Local* crawl looks like it missed JavaScript-rendered
 * content and should escalate to a browser provider. Deliberately conservative:
 * true only when the in-process crawler extracted **no usable pages at all** —
 * the canonical "JS SPA" signature (the server ships `<div id="root">` + scripts,
 * so cheerio finds nothing). This keeps Local the cheap default and only ever
 * triggers a browser *retry* (never data loss); a partial result (some pages
 * with content) is kept as-is rather than paying for a browser crawl. The
 * threshold can be tightened to a length heuristic once live retrieval data
 * (map #398, verify #405) shows nav-only-but-nonempty pages are a real problem.
 * Pure + unit-testable.
 */
export function localCrawlMissedContent(pages: Array<{ text: string }>): boolean {
  return pages.length === 0;
}

/**
 * The browser-capable provider to escalate a thin Local crawl to: prefer the
 * self-hosted Crawl4AI (no per-crawl SaaS cost), else the managed Apify, else
 * none (no browser provider configured → keep Local's result).
 */
export function browserCrawlerFor(
  capabilities: WebsiteCrawlerCapabilities
): Exclude<ResolvedWebsiteCrawlerProvider, "local"> | null {
  if (capabilities.crawl4aiConfigured) return "crawl4ai";
  if (capabilities.apifyConfigured) return "apify";
  return null;
}

export function crawlOptionsFromConfig(
  config: WebsiteSourceConfig
): CrawlOptions {
  return {
    maxPages: config.maxPages,
    includeGlobs: config.includeGlobs,
    excludeGlobs: config.excludeGlobs,
    fetchFiles: config.fetchFiles,
    throttle: config.throttle,
    pageTimeoutSecs: config.pageTimeoutSecs,
    waitSecs: config.waitSecs,
  };
}

/** Old Sources predate resolvedCrawlerProvider; their run marker is unambiguous. */
export function resolvedProviderForRun(
  config: WebsiteSourceConfig
): ResolvedWebsiteCrawlerProvider | null {
  if (config.resolvedCrawlerProvider) return config.resolvedCrawlerProvider;
  if (!config.crawlRunId) return null;
  return config.crawlRunId === LOCAL_CRAWL_RUN ? "local" : "apify";
}

export function websiteCrawlerAdapter(
  provider: ResolvedWebsiteCrawlerProvider
): WebsiteCrawlerAdapter {
  return adapters[provider];
}
