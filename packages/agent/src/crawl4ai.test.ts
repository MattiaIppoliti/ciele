import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCrawl4aiJob,
  getCrawl4aiTask,
  isCrawl4aiConfigured,
  isCrawl4aiSuccess,
  isCrawl4aiTerminal,
  mapCrawl4aiPages,
  redactCrawl4aiSecrets,
  startCrawl4ai,
} from "./crawl4ai";

/**
 * The pure request translation and response mapping, the parts of the
 * Crawl4AI integration that carry real rules (page clamp, same-origin BFS,
 * URL filters, throttle→concurrency, timeout/JS-wait mapping, disabled
 * hooks/extraction, markdown extraction), plus the two thin async-job calls
 * exercised against fake fetch responses instead of a live worker.
 */

/** Reaches into the built job's CrawlerRunConfig params. */
function crawlerParams(job: ReturnType<typeof buildCrawl4aiJob>) {
  return job.crawler_config.params as Record<string, unknown>;
}

/** Reaches into the built job's BFS deep-crawl strategy params. */
function deepCrawlParams(job: ReturnType<typeof buildCrawl4aiJob>) {
  const strategy = crawlerParams(job).deep_crawl_strategy as {
    params: Record<string, unknown>;
  };
  return strategy.params;
}

describe("buildCrawl4aiJob", () => {
  it("submits a same-origin BFS deep crawl, 20 pages, a 30s timeout, no hooks", () => {
    const job = buildCrawl4aiJob("https://x.edu");
    expect(job.urls).toEqual(["https://x.edu"]);
    expect(job.crawler_config.type).toBe("CrawlerRunConfig");
    expect(job.browser_config.type).toBe("BrowserConfig");

    const strategy = crawlerParams(job).deep_crawl_strategy as { type: string };
    expect(strategy.type).toBe("BFSDeepCrawlStrategy");
    const deep = deepCrawlParams(job);
    expect(deep.max_pages).toBe(20);
    expect(deep.include_external).toBe(false); // same-origin only
    expect(deep.filter_chain).toBeUndefined(); // no filters unless requested

    expect(crawlerParams(job).page_timeout).toBe(30_000);
    // A heuristic (non-LLM) pruning filter produces fit_markdown (main article).
    const md = crawlerParams(job).markdown_generator as {
      type: string;
      params: { content_filter: { type: string; params: Record<string, unknown> } };
    };
    expect(md.type).toBe("DefaultMarkdownGenerator");
    expect(md.params.content_filter.type).toBe("PruningContentFilter");
    // No extraction strategy or executable JS/hooks are ever attached.
    expect(crawlerParams(job).extraction_strategy).toBeUndefined();
    expect(crawlerParams(job).js_code).toBeUndefined();
    // Optional fields are absent unless requested.
    expect(crawlerParams(job).delay_before_return_html).toBeUndefined();
    expect(crawlerParams(job).semaphore_count).toBeUndefined();
  });

  it("clamps max_pages to 50", () => {
    expect(deepCrawlParams(buildCrawl4aiJob("https://x.edu", { maxPages: 500 })).max_pages).toBe(50);
    expect(deepCrawlParams(buildCrawl4aiJob("https://x.edu", { maxPages: 10 })).max_pages).toBe(10);
  });

  it("maps include/exclude globs to a filter chain and drops empty entries", () => {
    const deep = deepCrawlParams(
      buildCrawl4aiJob("https://x.edu", {
        includeGlobs: ["https://x.edu/docs/**", ""],
        excludeGlobs: ["https://x.edu/private/**"],
      })
    );
    const filters = (
      deep.filter_chain as {
        params: { filters: Array<{ type: string; params: Record<string, unknown> }> };
      }
    ).params.filters;
    expect(filters).toEqual([
      { type: "URLPatternFilter", params: { patterns: ["https://x.edu/docs/**"] } },
      {
        type: "URLPatternFilter",
        params: { patterns: ["https://x.edu/private/**"], reverse: true },
      },
    ]);
  });

  it("maps the JS wait and the per-page timeout", () => {
    const job = buildCrawl4aiJob("https://x.edu", { waitSecs: 3, pageTimeoutSecs: 45 });
    expect(crawlerParams(job).delay_before_return_html).toBe(3);
    expect(crawlerParams(job).page_timeout).toBe(45_000);
  });

  it("reduces concurrency and adds a delay when throttled", () => {
    const params = crawlerParams(buildCrawl4aiJob("https://x.edu", { throttle: true }));
    expect(params.semaphore_count).toBe(1);
    expect(params.mean_delay as number).toBeGreaterThan(0);
  });
});

describe("mapCrawl4aiPages", () => {
  it("extracts markdown (string or structured), title, url; drops empty", () => {
    const pages = mapCrawl4aiPages(
      [
        { url: "https://x.edu/a", markdown: "# A", metadata: { title: "Page A" } },
        {
          url: "https://x.edu/b",
          markdown: { fit_markdown: "fit B", raw_markdown: "raw B" },
        },
        { url: "https://x.edu/c", markdown: { raw_markdown: "raw C" } },
        { url: "https://x.edu/empty", markdown: "  " }, // whitespace → dropped
      ],
      "https://x.edu"
    );
    expect(pages).toEqual([
      { url: "https://x.edu/a", title: "Page A", text: "# A" },
      { url: "https://x.edu/b", title: "https://x.edu/b", text: "fit B" },
      { url: "https://x.edu/c", title: "https://x.edu/c", text: "raw C" },
    ]);
  });

  it("uses the fallback url and 'Untitled page' when an item omits both", () => {
    const pages = mapCrawl4aiPages([{ markdown: "orphan" }], "https://x.edu");
    expect(pages).toEqual([
      { url: "https://x.edu", title: "Untitled page", text: "orphan" },
    ]);
  });

  it("drops pages the worker marked failed and ignores malformed items", () => {
    const pages = mapCrawl4aiPages(
      [
        { url: "https://x.edu/ok", markdown: "good", success: true },
        { url: "https://x.edu/bad", markdown: "should not appear", success: false },
        null as never,
        "garbage" as never,
      ],
      "https://x.edu"
    );
    expect(pages).toEqual([
      { url: "https://x.edu/ok", title: "https://x.edu/ok", text: "good" },
    ]);
  });

  it("returns an empty array when every item is empty", () => {
    expect(
      mapCrawl4aiPages([{ markdown: "" }, { markdown: { raw_markdown: "" } }], "https://x.edu")
    ).toEqual([]);
  });
});

describe("redactCrawl4aiSecrets", () => {
  const original = process.env.CRAWL4AI_API_TOKEN;
  afterEach(() => {
    if (original === undefined) delete process.env.CRAWL4AI_API_TOKEN;
    else process.env.CRAWL4AI_API_TOKEN = original;
  });

  it("strips the configured token wherever it appears", () => {
    process.env.CRAWL4AI_API_TOKEN = "super-secret-token";
    const out = redactCrawl4aiSecrets(
      "upstream rejected token super-secret-token twice: super-secret-token"
    );
    expect(out).not.toContain("super-secret-token");
    expect(out).toContain("[redacted]");
  });

  it("strips bearer tokens and echoed authorization headers", () => {
    delete process.env.CRAWL4AI_API_TOKEN;
    const out = redactCrawl4aiSecrets(
      'denied: Authorization: Bearer abc.DEF-123 and {"authorization":"xyz789"}'
    );
    expect(out).not.toContain("abc.DEF-123");
    expect(out).not.toContain("xyz789");
    expect(out).toContain("[redacted]");
  });

  it("strips a standalone bearer token", () => {
    delete process.env.CRAWL4AI_API_TOKEN;
    expect(redactCrawl4aiSecrets("failed with Bearer abc.DEF-123 upstream")).toBe(
      "failed with Bearer [redacted] upstream"
    );
  });

  it("leaves credential-free text unchanged", () => {
    delete process.env.CRAWL4AI_API_TOKEN;
    expect(redactCrawl4aiSecrets("Crawl completed but returned no usable pages.")).toBe(
      "Crawl completed but returned no usable pages."
    );
  });
});

describe("task status classification", () => {
  it("treats only completed as a successful task (case-insensitive)", () => {
    expect(isCrawl4aiSuccess("completed")).toBe(true);
    expect(isCrawl4aiSuccess("COMPLETED")).toBe(true);
    for (const s of ["pending", "processing", "failed"]) {
      expect(isCrawl4aiSuccess(s)).toBe(false);
    }
  });

  it("marks finished tasks terminal and in-flight tasks non-terminal", () => {
    for (const s of ["completed", "COMPLETED", "failed", "FAILED"]) {
      expect(isCrawl4aiTerminal(s)).toBe(true);
    }
    for (const s of ["pending", "processing", "PROCESSING"]) {
      expect(isCrawl4aiTerminal(s)).toBe(false);
    }
  });
});

describe("worker HTTP calls", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    process.env.CRAWL4AI_BASE_URL = "https://crawler.internal";
    process.env.CRAWL4AI_API_TOKEN = "secret-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CRAWL4AI_BASE_URL;
    delete process.env.CRAWL4AI_API_TOKEN;
  });

  function jsonResponse(body: unknown, ok = true, status = 200) {
    return {
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }

  it("is configured only when both base URL and token are set", () => {
    expect(isCrawl4aiConfigured()).toBe(true);
    delete process.env.CRAWL4AI_API_TOKEN;
    expect(isCrawl4aiConfigured()).toBe(false);
  });

  it("submits an authenticated async job and returns the task id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ task_id: "task-123" }));

    const started = await startCrawl4ai("https://x.edu", { maxPages: 5 });

    expect(started).toEqual({ runId: "task-123", datasetId: "task-123" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://crawler.internal/crawl/job");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer secret-token");
    const body = JSON.parse(init.body);
    expect(body.urls).toEqual(["https://x.edu"]);
    const deep = body.crawler_config.params.deep_crawl_strategy.params;
    expect(deep.max_pages).toBe(5);
    expect(deep.include_external).toBe(false);
    // The token is never echoed into the request body.
    expect(init.body).not.toContain("secret-token");
  });

  it("throws a sanitized error (no token) when the submit fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse("upstream boom", false, 502));
    await expect(startCrawl4ai("https://x.edu")).rejects.toThrow(/502/);
    await expect(startCrawl4ai("https://x.edu")).rejects.not.toThrow(/secret-token/);
  });

  it("requires configuration before any network call", async () => {
    delete process.env.CRAWL4AI_BASE_URL;
    await expect(startCrawl4ai("https://x.edu")).rejects.toThrow(
      /CRAWL4AI_BASE_URL/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads a completed task's status and pages from the job endpoint", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: "completed",
        results: [{ url: "https://x.edu/a", markdown: "A" }],
      })
    );

    const task = await getCrawl4aiTask("task-123");

    expect(isCrawl4aiSuccess(task.status)).toBe(true);
    expect(task.results).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://crawler.internal/crawl/job/task-123");
    expect(init.headers.Authorization).toBe("Bearer secret-token");
  });

  it("reads completed pages that arrive under `data` (single or array)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: "completed",
        data: { url: "https://x.edu/a", markdown: "A" },
      })
    );
    const task = await getCrawl4aiTask("task-123");
    expect(task.results).toEqual([{ url: "https://x.edu/a", markdown: "A" }]);
  });

  it("defaults to processing and no pages on a malformed status body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    const task = await getCrawl4aiTask("task-123");
    expect(isCrawl4aiTerminal(task.status)).toBe(false);
    expect(task.results).toEqual([]);
  });

  it("redacts a credential the worker echoes into a task error", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: "failed",
        error: "auth rejected for Bearer secret-token (token=secret-token)",
      })
    );
    const task = await getCrawl4aiTask("task-123");
    expect(task.error).toBeDefined();
    expect(task.error).not.toContain("secret-token");
    expect(task.error).toContain("[redacted]");
  });

  it("sanitizes a token echoed in a failed task lookup body", async () => {
    fetchMock.mockResolvedValue(jsonResponse("denied token secret-token", false, 401));
    await expect(getCrawl4aiTask("task-123")).rejects.toThrow(/401/);
    await expect(getCrawl4aiTask("task-123")).rejects.not.toThrow(/secret-token/);
  });
});
