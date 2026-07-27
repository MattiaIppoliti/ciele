/**
 * Website crawling via a private Crawl4AI worker (its base URL + token come
 * from CRAWL4AI_BASE_URL / CRAWL4AI_API_TOKEN — never hardcode them). The
 * worker itself (a pinned, authenticated Crawl4AI container exposing only the
 * crawl/status/health endpoints) is packaged separately; this module is the
 * Ciele-side adapter that speaks its async Docker API.
 *
 * Like Apify, crawls run *asynchronously*: we submit a job (a quick POST to
 * `/crawl/job` that returns a task id), store that id on the Source, and later
 * poll the task (`GET /crawl/job/{task_id}`) and ingest its pages once it
 * completes. This keeps a minutes-long browser crawl off any single request's
 * lifetime.
 *
 * Deep crawling is breadth-first and same-origin by default (external-domain
 * traversal disabled), bounded by the product page budget. LLM extraction,
 * arbitrary hooks/JS, file downloads, and login automation stay disabled —
 * Ciele owns enrichment, Concepts, chunking, and embeddings.
 *
 * The Crawl4AI Docker API has changed across releases, so the request/response
 * shapes are kept small and mapped as pure transformations: the exact worker
 * contract is pinned and verified against the packaged image's smoke test
 * (#107), while these mappings are unit-tested off the network here.
 */

import type { CrawledPage, CrawlOptions } from "./apify";
import { redactBearerSecrets, trimTrailingSlash } from "./redact";

/** Same page budget the other providers clamp to. */
const MAX_CRAWL_PAGES = 50;

/** Default per-page navigation timeout (ms) when a Source doesn't set one. */
const DEFAULT_PAGE_TIMEOUT_MS = 30_000;

/** Bound the BFS depth so a wide site still terminates within the page budget. */
const MAX_CRAWL_DEPTH = 5;

/** Async-job endpoints on the worker's Docker API. */
const SUBMIT_PATH = "/crawl/job";
const taskPath = (taskId: string) => `/crawl/job/${encodeURIComponent(taskId)}`;

export function isCrawl4aiConfigured(): boolean {
  return Boolean(process.env.CRAWL4AI_BASE_URL && process.env.CRAWL4AI_API_TOKEN);
}

/**
 * Scrubs crawler credentials out of any text destined for a Source error, an
 * Alert, a client response, or telemetry. The worker token only ever travels
 * in the `Authorization` header, but a misconfigured or verbose worker could
 * echo it (or the raw header) back in an error body — so before any provider
 * text leaves this module it is stripped of the configured token and of any
 * bearer/authorization value, however cased or quoted.
 */
export function redactCrawl4aiSecrets(text: string): string {
  return redactBearerSecrets(text, process.env.CRAWL4AI_API_TOKEN);
}

/**
 * A Crawl4AI config object serializes as `{ type, params }`, which is how the
 * Docker API deserializes CrawlerRunConfig / BrowserConfig / deep-crawl
 * strategies and filters back into their library classes.
 */
interface TypedConfig {
  type: string;
  params: Record<string, unknown>;
}

/**
 * The async crawl job Ciele submits to the worker (`POST /crawl/job`). It is a
 * pure projection of CrawlOptions onto the Crawl4AI request envelope, with the
 * load-bearing safety rules baked in: page count is clamped, deep crawling is
 * BFS and same-origin (`include_external: false`), URL filters are applied, and
 * no extraction strategy or executable JS/hooks are ever attached.
 */
export interface Crawl4aiCrawlJob {
  urls: string[];
  browser_config: TypedConfig;
  crawler_config: TypedConfig;
}

/**
 * Translates our CrawlOptions into a Crawl4AI async crawl job. Pure so the
 * mapping rules (page clamp, same-origin BFS, include/exclude filters,
 * throttle→concurrency, page timeout, JS wait, and the absence of any
 * extraction strategy or hooks) are testable off the network.
 */
export function buildCrawl4aiJob(
  url: string,
  options: CrawlOptions = {}
): Crawl4aiCrawlJob {
  const maxPages = Math.min(options.maxPages ?? 20, MAX_CRAWL_PAGES);
  const include = (options.includeGlobs ?? []).filter(Boolean);
  const exclude = (options.excludeGlobs ?? []).filter(Boolean);

  const filters: TypedConfig[] = [];
  if (include.length) {
    filters.push({ type: "URLPatternFilter", params: { patterns: include } });
  }
  if (exclude.length) {
    // A reversed pattern filter rejects anything matching an exclude glob.
    filters.push({
      type: "URLPatternFilter",
      params: { patterns: exclude, reverse: true },
    });
  }

  const deepCrawlStrategy: TypedConfig = {
    type: "BFSDeepCrawlStrategy",
    params: {
      max_depth: MAX_CRAWL_DEPTH,
      max_pages: maxPages,
      // Restrict traversal to the start URL's origin (no open-web crawl).
      include_external: false,
      ...(filters.length
        ? {
            filter_chain: {
              type: "FilterChain",
              params: { filters },
            },
          }
        : {}),
    },
  };

  const crawlerParams: Record<string, unknown> = {
    deep_crawl_strategy: deepCrawlStrategy,
    // Always re-crawl; the Source, not the worker, owns freshness.
    cache_mode: "BYPASS",
    stream: false,
    page_timeout: (options.pageTimeoutSecs ?? DEFAULT_PAGE_TIMEOUT_MS / 1000) * 1000,
    // Produce `fit_markdown` — the pruned main article — via a heuristic
    // (non-LLM) content filter that drops nav/menus/boilerplate by text and
    // link density. Without this the worker only emits `raw_markdown` (full
    // chrome included), and `mapCrawl4aiPages` prefers `fit_markdown`. This is
    // *not* LLM extraction: Ciele still owns all enrichment/Concepts/embeddings.
    markdown_generator: {
      type: "DefaultMarkdownGenerator",
      params: {
        content_filter: {
          type: "PruningContentFilter",
          params: {
            threshold: 0.48,
            threshold_type: "dynamic",
            min_word_threshold: 5,
          },
        },
      },
    },
    // No extraction_strategy / js_code / hooks: Ciele owns enrichment, and the
    // worker must never run admin- or user-supplied code.
  };
  if (options.waitSecs) {
    // Extra settle time after load for JS-rendered pages.
    crawlerParams.delay_before_return_html = options.waitSecs;
  }
  if (options.throttle) {
    // Crawl politely: one page at a time with a delay between requests.
    crawlerParams.semaphore_count = 1;
    crawlerParams.mean_delay = 1;
  }

  return {
    urls: [url],
    browser_config: { type: "BrowserConfig", params: { headless: true } },
    crawler_config: { type: "CrawlerRunConfig", params: crawlerParams },
  };
}

/** One page from a completed worker task. `markdown` may be a string or the
 * worker's structured markdown object; both are supported. */
export interface Crawl4aiPageResult {
  url?: string;
  markdown?: string | { raw_markdown?: string; fit_markdown?: string } | null;
  metadata?: { title?: string } | null;
  success?: boolean;
}

function markdownText(markdown: Crawl4aiPageResult["markdown"]): string {
  if (typeof markdown === "string") return markdown;
  if (markdown && typeof markdown === "object") {
    return markdown.fit_markdown || markdown.raw_markdown || "";
  }
  return "";
}

/**
 * Maps completed task pages to Concepts-ready pages: pull the markdown body,
 * fall back through title → url → "Untitled page", drop pages the worker
 * marked failed or that carry no usable text, and ignore malformed items.
 * `fallbackUrl` is the start URL, used when an item omits its own.
 */
export function mapCrawl4aiPages(
  results: Crawl4aiPageResult[],
  fallbackUrl: string
): CrawledPage[] {
  return results
    .filter((item) => item && typeof item === "object" && item.success !== false)
    .map((item) => ({
      url: item.url ?? fallbackUrl,
      title: item.metadata?.title ?? item.url ?? "Untitled page",
      text: markdownText(item.markdown).trim(),
    }))
    .filter((page) => page.text.length > 0);
}

/** Worker task lifecycle states (the subset we branch on). Case varies across
 * worker releases, so classification is case-insensitive. */
export type Crawl4aiTaskStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | string;

/** Completed is the only status we ingest from; the rest are running or failed. */
export function isCrawl4aiSuccess(status: Crawl4aiTaskStatus): boolean {
  return status.toLowerCase() === "completed";
}

/** A task is terminal once the worker will do no more work on it. */
export function isCrawl4aiTerminal(status: Crawl4aiTaskStatus): boolean {
  const normalized = status.toLowerCase();
  return normalized === "completed" || normalized === "failed";
}

export interface Crawl4aiTaskState {
  status: Crawl4aiTaskStatus;
  results: Crawl4aiPageResult[];
  error?: string;
}

function requireConfig(): { baseUrl: string; token: string } {
  const baseUrl = process.env.CRAWL4AI_BASE_URL;
  const token = process.env.CRAWL4AI_API_TOKEN;
  if (!baseUrl || !token) {
    throw new Error(
      "CRAWL4AI_BASE_URL and CRAWL4AI_API_TOKEN must be set — required for the Crawl4AI crawler."
    );
  }
  return { baseUrl: trimTrailingSlash(baseUrl), token };
}

/** A started (still-running) crawl: what we persist on the Source to track it. */
export interface StartedCrawl4ai {
  runId: string;
  datasetId: string;
}

/**
 * Submits an async crawl job and returns its task id immediately. A fast POST —
 * safe to await inside a request. The token is sent as a Bearer header and
 * never included in the request body, logs, or the returned value.
 */
export async function startCrawl4ai(
  url: string,
  options: CrawlOptions = {}
): Promise<StartedCrawl4ai> {
  const { baseUrl, token } = requireConfig();
  const job = buildCrawl4aiJob(url, options);

  const response = await fetch(`${baseUrl}${SUBMIT_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(job),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Crawl4AI job failed to start (${response.status}): ${redactCrawl4aiSecrets(detail).slice(0, 200)}`
    );
  }

  const { task_id: taskId } = (await response.json().catch(() => ({}))) as {
    task_id?: string;
  };
  if (!taskId) {
    throw new Error("Crawl4AI job started but returned no task id");
  }
  // The worker key is the task id; there is no separate dataset to track.
  return { runId: taskId, datasetId: taskId };
}

/** Raw shape of a task-status response; completed pages land under `results`
 * or `data` (an array for deep crawls, a single object for a one-URL crawl). */
type Crawl4aiTaskBody = {
  status?: string;
  results?: Crawl4aiPageResult[];
  data?: Crawl4aiPageResult[] | Crawl4aiPageResult;
  result?: Crawl4aiPageResult[] | Crawl4aiPageResult;
  error?: string;
};

function taskResults(body: Crawl4aiTaskBody): Crawl4aiPageResult[] {
  const payload = body.results ?? body.data ?? body.result;
  if (Array.isArray(payload)) return payload;
  return payload ? [payload] : [];
}

/** Reads an async task's current status (and its pages once completed). */
export async function getCrawl4aiTask(taskId: string): Promise<Crawl4aiTaskState> {
  const { baseUrl, token } = requireConfig();
  const response = await fetch(`${baseUrl}${taskPath(taskId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Crawl4AI task lookup failed (${response.status}): ${redactCrawl4aiSecrets(detail).slice(0, 200)}`
    );
  }
  const body = (await response.json().catch(() => ({}))) as Crawl4aiTaskBody;
  return {
    status: (body.status ?? "PROCESSING") as Crawl4aiTaskStatus,
    results: taskResults(body),
    // A worker-reported error is provider response detail — redact before it
    // can reach a Source error, an Alert, or telemetry.
    error: body.error ? redactCrawl4aiSecrets(body.error) : body.error,
  };
}
