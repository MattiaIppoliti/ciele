import { beforeEach, describe, expect, it, vi } from "vitest";
import { type WebsiteSourceConfig } from "@agent-hub/core";
import { DEMO_ORG, getMockDb, type Db } from "@agent-hub/db";

vi.mock("./apify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./apify")>()),
  isApifyConfigured: vi.fn(),
  startCrawl: vi.fn(),
  getRunState: vi.fn(),
  fetchCrawledPages: vi.fn(),
}));

vi.mock("./local-crawl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./local-crawl")>()),
  localCrawl: vi.fn(),
}));

vi.mock("./crawl4ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./crawl4ai")>()),
  isCrawl4aiConfigured: vi.fn(),
  startCrawl4ai: vi.fn(),
  getCrawl4aiTask: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

import { lookup } from "node:dns/promises";
import {
  fetchCrawledPages,
  getRunState,
  isApifyConfigured,
  startCrawl,
} from "./apify";
import {
  getCrawl4aiTask,
  isCrawl4aiConfigured,
  startCrawl4ai,
} from "./crawl4ai";
import { LOCAL_CRAWL_RUN, localCrawl } from "./local-crawl";
import { beginWebsiteCrawl, finalizeWebsiteCrawl } from "./ingest";

describe("Website Source crawler providers", () => {
  const isApifyConfiguredMock = vi.mocked(isApifyConfigured);
  const startCrawlMock = vi.mocked(startCrawl);
  const getRunStateMock = vi.mocked(getRunState);
  const fetchCrawledPagesMock = vi.mocked(fetchCrawledPages);
  const localCrawlMock = vi.mocked(localCrawl);
  const isCrawl4aiConfiguredMock = vi.mocked(isCrawl4aiConfigured);
  const startCrawl4aiMock = vi.mocked(startCrawl4ai);
  const getCrawl4aiTaskMock = vi.mocked(getCrawl4aiTask);
  const lookupMock = vi.mocked(lookup);

  async function seed(db: Db, name: string, config: WebsiteSourceConfig) {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: name });
    const collection = await db.createCollection(assistant.id, { name });
    const source = await db.createSource({
      collectionId: collection.id,
      name,
      kind: "website",
      config,
    });
    return { assistantId: assistant.id, collectionId: collection.id, source };
  }

  beforeEach(() => {
    isApifyConfiguredMock.mockReset();
    startCrawlMock.mockReset();
    getRunStateMock.mockReset();
    fetchCrawledPagesMock.mockReset();
    localCrawlMock.mockReset();
    isCrawl4aiConfiguredMock.mockReset();
    startCrawl4aiMock.mockReset();
    getCrawl4aiTaskMock.mockReset();
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as never);
  });

  it("starts an explicitly Local crawl even when Apify is configured", async () => {
    const db = getMockDb();
    const { source } = await seed(db, "explicit-local", {
      url: "https://x.edu",
      crawlerProvider: "local",
    });
    isApifyConfiguredMock.mockReturnValue(true);

    await beginWebsiteCrawl({ db, sourceId: source.id });

    expect(startCrawlMock).not.toHaveBeenCalled();
    expect((await db.getSource(source.id))?.config).toMatchObject({
      crawlerProvider: "local",
      resolvedCrawlerProvider: "local",
      crawlRunId: LOCAL_CRAWL_RUN,
      crawlDatasetId: LOCAL_CRAWL_RUN,
    });
  });

  it("starts an explicitly Apify crawl and records the resolved provider", async () => {
    const db = getMockDb();
    const { source } = await seed(db, "explicit-apify", {
      url: "https://x.edu",
      crawlerProvider: "apify",
    });
    isApifyConfiguredMock.mockReturnValue(true);
    startCrawlMock.mockResolvedValue({ runId: "run-apify", datasetId: "ds-apify" });

    await beginWebsiteCrawl({ db, sourceId: source.id });

    expect(startCrawlMock).toHaveBeenCalledOnce();
    expect((await db.getSource(source.id))?.config).toMatchObject({
      crawlerProvider: "apify",
      resolvedCrawlerProvider: "apify",
      crawlRunId: "run-apify",
      crawlDatasetId: "ds-apify",
    });
  });

  it("routes a legacy Source without provider metadata by the Automatic policy", async () => {
    const db = getMockDb();
    // A small static crawl (default budget, no JS wait / files / login) now
    // resolves to the in-process crawler even when Apify is configured.
    const { source } = await seed(db, "legacy-auto", { url: "https://x.edu" });
    isApifyConfiguredMock.mockReturnValue(true);

    await beginWebsiteCrawl({ db, sourceId: source.id });

    expect(startCrawlMock).not.toHaveBeenCalled();
    expect((await db.getSource(source.id))?.config).toMatchObject({
      resolvedCrawlerProvider: "local",
      crawlRunId: LOCAL_CRAWL_RUN,
    });
  });

  it("routes an Automatic browser-rendered crawl to Crawl4AI when configured", async () => {
    const db = getMockDb();
    const { source } = await seed(db, "auto-browser", {
      url: "https://x.edu",
      crawlerProvider: "auto",
      waitSecs: 2,
    });
    isApifyConfiguredMock.mockReturnValue(true);
    isCrawl4aiConfiguredMock.mockReturnValue(true);
    startCrawl4aiMock.mockResolvedValue({ runId: "task-auto", datasetId: "task-auto" });

    await beginWebsiteCrawl({ db, sourceId: source.id });

    expect(startCrawl4aiMock).toHaveBeenCalledOnce();
    expect(startCrawlMock).not.toHaveBeenCalled();
    expect((await db.getSource(source.id))?.config).toMatchObject({
      resolvedCrawlerProvider: "crawl4ai",
      crawlRunId: "task-auto",
    });
  });

  it("routes an Automatic file-download crawl to Apify", async () => {
    const db = getMockDb();
    const { source } = await seed(db, "auto-files", {
      url: "https://x.edu",
      crawlerProvider: "auto",
      fetchFiles: true,
    });
    isApifyConfiguredMock.mockReturnValue(true);
    isCrawl4aiConfiguredMock.mockReturnValue(true);
    startCrawlMock.mockResolvedValue({ runId: "run-files", datasetId: "ds-files" });

    await beginWebsiteCrawl({ db, sourceId: source.id });

    expect(startCrawlMock).toHaveBeenCalledOnce();
    expect(startCrawl4aiMock).not.toHaveBeenCalled();
    expect((await db.getSource(source.id))?.config).toMatchObject({
      resolvedCrawlerProvider: "apify",
      crawlRunId: "run-files",
    });
  });

  it("lands the Source in error when Automatic finds no compatible provider", async () => {
    const db = getMockDb();
    const { source } = await seed(db, "auto-none", {
      url: "https://x.edu",
      crawlerProvider: "auto",
      fetchFiles: true,
    });
    isApifyConfiguredMock.mockReturnValue(false);
    isCrawl4aiConfiguredMock.mockReturnValue(false);

    await beginWebsiteCrawl({ db, sourceId: source.id });

    expect(startCrawlMock).not.toHaveBeenCalled();
    expect(startCrawl4aiMock).not.toHaveBeenCalled();
    const stored = await db.getSource(source.id);
    expect(stored?.status).toBe("error");
    expect(stored?.error).toMatch(/Apify/);
    expect(stored?.config.resolvedCrawlerProvider).toBeUndefined();
  });

  it("finalizes with the provider resolved at start after configuration changes", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "stable-provider", {
      url: "https://x.edu",
      crawlerProvider: "local",
    });
    isApifyConfiguredMock.mockReturnValue(true);
    await beginWebsiteCrawl({ db, sourceId: source.id });

    const started = await db.getSource(source.id);
    await db.updateSource(source.id, {
      config: { ...started!.config, crawlerProvider: "apify" },
    });
    localCrawlMock.mockResolvedValue([
      { url: "https://x.edu/a", title: "A", text: "Alpha" },
    ]);

    const status = await finalizeWebsiteCrawl({
      db,
      assistantId,
      collectionId,
      sourceId: source.id,
    });

    expect(status).toBe("ready");
    expect(localCrawlMock).toHaveBeenCalledOnce();
    expect(getRunStateMock).not.toHaveBeenCalled();
  });

  it("finalizes a legacy local marker without provider metadata via the local crawler", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "legacy-local-run", {
      url: "https://x.edu",
      crawlRunId: LOCAL_CRAWL_RUN,
      crawlDatasetId: LOCAL_CRAWL_RUN,
    });
    isApifyConfiguredMock.mockReturnValue(true);
    localCrawlMock.mockResolvedValue([
      { url: "https://x.edu/a", title: "A", text: "Alpha" },
    ]);

    const status = await finalizeWebsiteCrawl({
      db,
      assistantId,
      collectionId,
      sourceId: source.id,
    });

    expect(status).toBe("ready");
    expect(localCrawlMock).toHaveBeenCalledOnce();
    expect(getRunStateMock).not.toHaveBeenCalled();
    expect(await db.listConcepts(collectionId)).toHaveLength(1);
  });

  it("finalizes a legacy Apify run identifier even after the token disappears", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "legacy-apify-run", {
      url: "https://x.edu",
      crawlRunId: "run-legacy",
      crawlDatasetId: "ds-legacy",
    });
    isApifyConfiguredMock.mockReturnValue(false);
    getRunStateMock.mockResolvedValue({ status: "SUCCEEDED", datasetId: "ds-legacy" });
    fetchCrawledPagesMock.mockResolvedValue([
      { url: "https://x.edu/a", title: "A", text: "Alpha" },
    ]);

    const status = await finalizeWebsiteCrawl({
      db,
      assistantId,
      collectionId,
      sourceId: source.id,
    });

    expect(status).toBe("ready");
    expect(localCrawlMock).not.toHaveBeenCalled();
    expect(await db.listConcepts(collectionId)).toHaveLength(1);
  });

  it("clears stale run metadata before awaiting a replacement provider run", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "replace-run", {
      url: "https://x.edu",
      crawlerProvider: "apify",
      resolvedCrawlerProvider: "apify",
      crawlRunId: "old-run",
      crawlDatasetId: "old-dataset",
    });
    isApifyConfiguredMock.mockReturnValue(true);
    let finishStart!: (value: { runId: string; datasetId: string }) => void;
    startCrawlMock.mockReturnValue(
      new Promise((resolve) => {
        finishStart = resolve;
      })
    );

    const beginning = beginWebsiteCrawl({ db, sourceId: source.id });
    await vi.waitFor(async () => {
      expect((await db.getSource(source.id))?.config).toMatchObject({
        resolvedCrawlerProvider: "apify",
      });
      expect((await db.getSource(source.id))?.config.crawlRunId).toBeUndefined();
    });

    const status = await finalizeWebsiteCrawl({
      db,
      assistantId,
      collectionId,
      sourceId: source.id,
    });
    expect(status).toBe("processing");
    expect(getRunStateMock).not.toHaveBeenCalled();

    finishStart({ runId: "new-run", datasetId: "new-dataset" });
    await beginning;
    expect((await db.getSource(source.id))?.config).toMatchObject({
      crawlRunId: "new-run",
      crawlDatasetId: "new-dataset",
    });
  });

  it("starts an explicitly Crawl4AI crawl and records the resolved provider", async () => {
    const db = getMockDb();
    const { source } = await seed(db, "explicit-crawl4ai", {
      url: "https://x.edu",
      crawlerProvider: "crawl4ai",
    });
    isCrawl4aiConfiguredMock.mockReturnValue(true);
    startCrawl4aiMock.mockResolvedValue({ runId: "task-1", datasetId: "task-1" });

    await beginWebsiteCrawl({ db, sourceId: source.id });

    expect(startCrawl4aiMock).toHaveBeenCalledOnce();
    expect(startCrawlMock).not.toHaveBeenCalled();
    expect(localCrawlMock).not.toHaveBeenCalled();
    expect((await db.getSource(source.id))?.config).toMatchObject({
      crawlerProvider: "crawl4ai",
      resolvedCrawlerProvider: "crawl4ai",
      crawlRunId: "task-1",
      crawlDatasetId: "task-1",
    });
  });

  it("finalizes a Crawl4AI crawl into ready with one Concept per page", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "crawl4ai-success", {
      url: "https://x.edu",
      crawlerProvider: "crawl4ai",
    });
    isCrawl4aiConfiguredMock.mockReturnValue(true);
    startCrawl4aiMock.mockResolvedValue({ runId: "task-1", datasetId: "task-1" });
    await beginWebsiteCrawl({ db, sourceId: source.id });

    getCrawl4aiTaskMock.mockResolvedValue({
      status: "COMPLETED",
      results: [
        { url: "https://x.edu/a", markdown: "Alpha", metadata: { title: "A" } },
        { url: "https://x.edu/b", markdown: "Beta", metadata: { title: "B" } },
      ],
    });

    const status = await finalizeWebsiteCrawl({
      db,
      assistantId,
      collectionId,
      sourceId: source.id,
    });

    expect(status).toBe("ready");
    expect(getRunStateMock).not.toHaveBeenCalled();
    const concepts = await db.listConcepts(collectionId);
    expect(concepts).toHaveLength(2);
    expect(concepts.every((c) => c.sourceId === source.id)).toBe(true);
  });

  it("stays processing while a Crawl4AI task is still running", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "crawl4ai-running", {
      url: "https://x.edu",
      crawlerProvider: "crawl4ai",
    });
    isCrawl4aiConfiguredMock.mockReturnValue(true);
    startCrawl4aiMock.mockResolvedValue({ runId: "task-1", datasetId: "task-1" });
    await beginWebsiteCrawl({ db, sourceId: source.id });
    getCrawl4aiTaskMock.mockResolvedValue({ status: "PROCESSING", results: [] });

    const status = await finalizeWebsiteCrawl({
      db,
      assistantId,
      collectionId,
      sourceId: source.id,
    });

    expect(status).toBe("processing");
    expect(await db.listConcepts(collectionId)).toHaveLength(0);
  });

  it("marks error when a Crawl4AI task fails", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "crawl4ai-failed", {
      url: "https://x.edu",
      crawlerProvider: "crawl4ai",
    });
    isCrawl4aiConfiguredMock.mockReturnValue(true);
    startCrawl4aiMock.mockResolvedValue({ runId: "task-1", datasetId: "task-1" });
    await beginWebsiteCrawl({ db, sourceId: source.id });
    getCrawl4aiTaskMock.mockResolvedValue({
      status: "FAILED",
      results: [],
      error: "browser crashed",
    });

    const status = await finalizeWebsiteCrawl({
      db,
      assistantId,
      collectionId,
      sourceId: source.id,
    });

    expect(status).toBe("error");
    expect((await db.getSource(source.id))?.error).toMatch(/browser crashed/i);
  });

  it("marks error when a completed Crawl4AI task has no usable pages", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "crawl4ai-empty", {
      url: "https://x.edu",
      crawlerProvider: "crawl4ai",
    });
    isCrawl4aiConfiguredMock.mockReturnValue(true);
    startCrawl4aiMock.mockResolvedValue({ runId: "task-1", datasetId: "task-1" });
    await beginWebsiteCrawl({ db, sourceId: source.id });
    getCrawl4aiTaskMock.mockResolvedValue({
      status: "COMPLETED",
      results: [{ url: "https://x.edu/a", markdown: "   " }],
    });

    const status = await finalizeWebsiteCrawl({
      db,
      assistantId,
      collectionId,
      sourceId: source.id,
    });

    expect(status).toBe("error");
    expect((await db.getSource(source.id))?.error).toMatch(/no usable pages/i);
  });

  it("lands the Source in error when an explicit Crawl4AI worker is unavailable", async () => {
    const db = getMockDb();
    const { source } = await seed(db, "crawl4ai-unconfigured", {
      url: "https://x.edu",
      crawlerProvider: "crawl4ai",
    });
    isCrawl4aiConfiguredMock.mockReturnValue(false);
    startCrawl4aiMock.mockRejectedValue(
      new Error("CRAWL4AI_BASE_URL and CRAWL4AI_API_TOKEN must be set")
    );

    await beginWebsiteCrawl({ db, sourceId: source.id });

    expect((await db.getSource(source.id))?.status).toBe("error");
    // Resolution still records the explicit choice even when unavailable.
    expect((await db.getSource(source.id))?.config.resolvedCrawlerProvider).toBe(
      "crawl4ai"
    );
  });

  it("only lets one concurrent finalizer ingest a Crawl4AI crawl", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "crawl4ai-once", {
      url: "https://x.edu",
      crawlerProvider: "crawl4ai",
    });
    isCrawl4aiConfiguredMock.mockReturnValue(true);
    startCrawl4aiMock.mockResolvedValue({ runId: "task-1", datasetId: "task-1" });
    await beginWebsiteCrawl({ db, sourceId: source.id });
    getCrawl4aiTaskMock.mockResolvedValue({
      status: "COMPLETED",
      results: [{ url: "https://x.edu/a", markdown: "Alpha", metadata: { title: "A" } }],
    });

    const statuses = await Promise.all([
      finalizeWebsiteCrawl({ db, assistantId, collectionId, sourceId: source.id }),
      finalizeWebsiteCrawl({ db, assistantId, collectionId, sourceId: source.id }),
    ]);

    expect(statuses).toContain("ready");
    expect(await db.listConcepts(collectionId)).toHaveLength(1);
  });
});
