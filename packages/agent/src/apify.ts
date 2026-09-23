/**
 * Website crawling via Apify's Website Content Crawler. The token is the
 * Organization's own Crawler Connection when it has one (Settings → Crawling),
 * passed in as `token`; otherwise the platform's APIFY_API_TOKEN. Never
 * hardcode it.
 *
 * Crawls run *asynchronously*: we start an Apify run (a quick POST), store its
 * run/dataset ids on the Source, and later poll the run and ingest its dataset
 * when it succeeds. This decouples a potentially minutes-long crawl from any
 * single request's lifetime, the reason a synchronous crawl could leave a
 * Source stuck on `processing` when a serverless function timed out mid-crawl.
 */

import { bearerRequest } from "./bearer-fetch";

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
/** Managed-crawler safety ceiling; ingestion consumes results in small batches. */
export const APIFY_MAX_CRAWL_PAGES = 100_000;
export const APIFY_DATASET_BATCH_SIZE = 100;

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
 * page count is clamped to APIFY_MAX_CRAWL_PAGES; the crawler always runs the adaptive
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
    maxCrawlPages: Math.min(
      options.maxPages ?? 20,
      APIFY_MAX_CRAWL_PAGES
    ),
    // Use the actor's adaptive engine: it renders JavaScript when a page needs
    // it and stays on fast raw HTTP when it doesn't, so client-rendered pages
    // aren't silently missed. We used to force `cheerio` unless an admin set
    // `waitSecs`; admins never did, so JS-rendered pages came back nav-only.
    crawlerType: "playwright:adaptive",
    saveMarkdown: true,
    // Isolate the main article: strip nav / menus / boilerplate to readable
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

function requireToken(token?: string): string {
  const resolved = token || process.env.APIFY_API_TOKEN;
  if (!resolved) {
    throw new Error(
      "No Apify API token: connect one in Settings → Crawling, or set APIFY_API_TOKEN."
    );
  }
  return resolved;
}

/**
 * Confirms an Apify token works and names the account it belongs to, before
 * an Organization's Crawler Connection stores it. `GET /v2/users/me` is the
 * cheapest authenticated call Apify has and costs no credits.
 */
export async function verifyApifyToken(
  token: string
): Promise<{ accountId: string; username: string }> {
  const { data } = await bearerRequest<{
    data?: { id?: string; username?: string };
  }>("https://api.apify.com/v2/users/me", {
    token,
    timeoutMs: 15_000,
    errorLabel: "Apify rejected the token",
  });
  if (!data?.id) throw new Error("Apify accepted the token but named no account");
  return { accountId: data.id, username: data.username ?? "" };
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
 * A fast POST: safe to await inside a request without risking a timeout.
 */
export async function startCrawl(
  url: string,
  options: CrawlOptions = {},
  token?: string
): Promise<StartedCrawl> {
  const { data } = await bearerRequest<{
    data?: { id?: string; defaultDatasetId?: string };
  }>(`https://api.apify.com/v2/acts/${ACTOR}/runs?memory=4096`, {
    token: requireToken(token),
    body: buildCrawlInput(url, options),
    timeoutMs: 30_000,
    errorLabel: "Apify run failed to start",
  });
  if (!data?.id || !data.defaultDatasetId) {
    throw new Error("Apify run started but returned no run/dataset id");
  }
  return { runId: data.id, datasetId: data.defaultDatasetId };
}

/** Reads an async run's current status (and its dataset id). */
export async function getRunState(
  runId: string,
  token?: string
): Promise<CrawlRunState> {
  const { data } = await bearerRequest<{
    data?: { status?: string; defaultDatasetId?: string };
  }>(`https://api.apify.com/v2/actor-runs/${runId}`, {
    token: requireToken(token),
    timeoutMs: 30_000,
    errorLabel: "Apify run lookup failed",
  });
  return {
    status: (data?.status ?? "RUNNING") as ApifyRunStatus,
    datasetId: data?.defaultDatasetId ?? "",
  };
}

/** Reads one bounded window. Offset advances by raw rows, including empty ones. */
export async function fetchCrawledPageBatch(
  datasetId: string,
  fallbackUrl: string,
  options: { offset?: number; limit?: number } = {},
  token?: string
): Promise<{ pages: CrawledPage[]; nextOffset: number | null }> {
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const limit = Math.max(
    1,
    Math.min(Math.trunc(options.limit ?? APIFY_DATASET_BATCH_SIZE), 1_000)
  );
  const items = await bearerRequest<ApifyItem[]>(
    `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&offset=${offset}&limit=${limit}`,
    {
      token: requireToken(token),
      timeoutMs: 60_000,
      errorLabel: "Apify dataset fetch failed",
    }
  );
  const rows = Array.isArray(items) ? items : [];
  return {
    pages: mapCrawledPages(rows, fallbackUrl),
    nextOffset: rows.length < limit ? null : offset + rows.length,
  };
}

/** Compatibility helper for callers that intentionally materialize a small dataset. */
export async function fetchCrawledPages(
  datasetId: string,
  fallbackUrl: string,
  token?: string
): Promise<CrawledPage[]> {
  const pages: CrawledPage[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const batch = await fetchCrawledPageBatch(
      datasetId,
      fallbackUrl,
      { offset },
      token
    );
    pages.push(...batch.pages);
    offset = batch.nextOffset;
  }
  return pages;
}
