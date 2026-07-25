/**
 * Website crawling via Apify's Website Content Crawler. The token comes
 * from APIFY_API_TOKEN (never hardcode it).
 *
 * Crawls run *asynchronously*: we start an Apify run (a quick POST), store its
 * run/dataset ids on the Source, and later poll the run and ingest its dataset
 * when it succeeds. This decouples a potentially minutes-long crawl from any
 * single request's lifetime — the reason a synchronous crawl could leave a
 * Source stuck on `processing` when a serverless function timed out mid-crawl.
 */

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
}

export interface CrawlOptions {
  maxPages?: number;
  includeGlobs?: string[];
  excludeGlobs?: string[];
  /** Also download and parse linked files (PDFs etc.) during the crawl. */
  fetchFiles?: boolean;
  /** Crawl politely: one request at a time. */
  throttle?: boolean;
  /** Per-page navigation timeout in seconds. */
  pageTimeoutSecs?: number;
  /** Extra wait after load before extracting content (JS-rendered pages). */
  waitSecs?: number;
}

const ACTOR = "apify~website-content-crawler";
const MAX_CRAWL_PAGES = 50;

export function isApifyConfigured(): boolean {
  return Boolean(process.env.APIFY_API_TOKEN);
}

/** One raw dataset item from the Apify Website Content Crawler. */
export interface ApifyItem {
  url?: string;
  markdown?: string;
  text?: string;
  metadata?: { title?: string };
}

/**
 * Translates our CrawlOptions into the actor's input. The load-bearing rules:
 * page count is clamped to MAX_CRAWL_PAGES; the crawler always runs the adaptive
 * engine (renders JS when needed) with readable-text extraction and a settle
 * wait; a `waitSecs` only raises that wait. The rest are optional fields sent
 * only when set. Pure so these rules are testable off the network.
 */
export function buildCrawlInput(
  url: string,
  options: CrawlOptions = {}
): Record<string, unknown> {
  return {
    startUrls: [{ url }],
    maxCrawlPages: Math.min(options.maxPages ?? 20, MAX_CRAWL_PAGES),
    // Use the actor's adaptive engine: it renders JavaScript when a page needs
    // it and stays on fast raw HTTP when it doesn't — so client-rendered pages
    // aren't silently missed. We used to force `cheerio` unless an admin set
    // `waitSecs`; admins never did, so JS-rendered pages came back nav-only.
    crawlerType: "playwright:adaptive",
    saveMarkdown: true,
    // Isolate the main article — strip nav / menus / boilerplate to readable
    // text (the actor's own default, which our old input silently discarded).
    htmlTransformer: "readableText",
    removeCookieWarnings: true,
    // Let dynamic content settle even when no per-Source wait is configured; a
    // Source-level `waitSecs` still overrides the default.
    dynamicContentWaitSecs: options.waitSecs ?? 10,
    ...(options.fetchFiles ? { saveFiles: true } : {}),
    ...(options.throttle ? { maxConcurrency: 1 } : {}),
    ...(options.pageTimeoutSecs
      ? { requestTimeoutSecs: options.pageTimeoutSecs }
      : {}),
    ...(options.includeGlobs?.length
      ? { includeUrlGlobs: options.includeGlobs.map((glob) => ({ glob })) }
      : {}),
    ...(options.excludeGlobs?.length
      ? { excludeUrlGlobs: options.excludeGlobs.map((glob) => ({ glob })) }
      : {}),
  };
}

/**
 * Maps raw dataset items to Concepts-ready pages: prefer markdown over text,
 * fall back through title → url → "Untitled page", and drop empty pages.
 * `fallbackUrl` is the start URL, used when an item omits its own.
 */
export function mapCrawledPages(
  items: ApifyItem[],
  fallbackUrl: string
): CrawledPage[] {
  return items
    .map((item) => ({
      url: item.url ?? fallbackUrl,
      title: item.metadata?.title ?? item.url ?? "Untitled page",
      text: (item.markdown || item.text || "").trim(),
    }))
    .filter((page) => page.text.length > 0);
}

function requireToken(): string {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    throw new Error(
      "APIFY_API_TOKEN is not set — required for website crawling."
    );
  }
  return token;
}

/** A started (still-running) crawl: what we persist on the Source to track it. */
export interface StartedCrawl {
  runId: string;
  datasetId: string;
}

/** Apify run lifecycle states (the subset we branch on). */
export type ApifyRunStatus =
  | "READY"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "ABORTING"
  | "ABORTED"
  | "TIMED-OUT"
  | string;

export interface CrawlRunState {
  status: ApifyRunStatus;
  datasetId: string;
}

/** SUCCEEDED is the only status we ingest from; the rest are still-running or failed. */
export function isRunSuccess(status: ApifyRunStatus): boolean {
  return status === "SUCCEEDED";
}

/** A run is terminal once Apify will do no more work on it. */
export function isRunTerminal(status: ApifyRunStatus): boolean {
  return (
    status === "SUCCEEDED" ||
    status === "FAILED" ||
    status === "ABORTED" ||
    status === "TIMED-OUT"
  );
}

/**
 * Kicks off an async crawl and returns immediately with its run/dataset ids.
 * A fast POST — safe to await inside a request without risking a timeout.
 */
export async function startCrawl(
  url: string,
  options: CrawlOptions = {}
): Promise<StartedCrawl> {
  const token = requireToken();
  const input = buildCrawlInput(url, options);

  const response = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/runs?memory=4096`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30_000),
    }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Apify run failed to start (${response.status}): ${detail.slice(0, 200)}`
    );
  }

  const { data } = (await response.json()) as {
    data?: { id?: string; defaultDatasetId?: string };
  };
  if (!data?.id || !data.defaultDatasetId) {
    throw new Error("Apify run started but returned no run/dataset id");
  }
  return { runId: data.id, datasetId: data.defaultDatasetId };
}

/** Reads an async run's current status (and its dataset id). */
export async function getRunState(runId: string): Promise<CrawlRunState> {
  const token = requireToken();
  const response = await fetch(
    `https://api.apify.com/v2/actor-runs/${runId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Apify run lookup failed (${response.status}): ${detail.slice(0, 200)}`
    );
  }
  const { data } = (await response.json()) as {
    data?: { status?: string; defaultDatasetId?: string };
  };
  return {
    status: (data?.status ?? "RUNNING") as ApifyRunStatus,
    datasetId: data?.defaultDatasetId ?? "",
  };
}

/** Fetches all crawled pages from a finished run's dataset. */
export async function fetchCrawledPages(
  datasetId: string,
  fallbackUrl: string
): Promise<CrawledPage[]> {
  const token = requireToken();
  const response = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&format=json`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60_000),
    }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Apify dataset fetch failed (${response.status}): ${detail.slice(0, 200)}`
    );
  }
  const items = (await response.json()) as ApifyItem[];
  return mapCrawledPages(items, fallbackUrl);
}
