import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEMO_ORG,
  getMockDb,
  type WebsiteSourceConfig,
} from "@agent-hub/db";

// Mock only the network primitives; the provider-resolution policy, the shared
// start/finalize lifecycle, and the mock DB's claim/lease semantics all run for
// real so the scheduled path is exercised exactly as production wires it.
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

// Both cron routes reach the durable store through the service-role widget DB;
// point it at the shared in-memory mock so the sweep and the finalizer act on
// the same Sources the test seeds.
vi.mock("@/lib/widget-db", () => ({ getWidgetDb: () => getMockDb() }));

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
import { GET as sweepRecrawls } from "@/app/api/cron/sweep-recrawls/route";
import { GET as finalizeCrawls } from "@/app/api/cron/finalize-crawls/route";

/**
 * The scheduled re-crawl seam (issue #109): a due Source picked up by the sweep
 * cron must resolve + persist its provider through the *same* start operation as
 * a manual re-crawl, then finalize through the shared lifecycle — the scheduler
 * only decides *when*, never *how*. These tests drive the two real cron routes
 * (sweep → finalize) against the mock DB, asserting observable Source/Concept
 * outcomes for each provider rather than provider internals.
 */
describe("scheduled re-crawl provider seam", () => {
  const isApifyConfiguredMock = vi.mocked(isApifyConfigured);
  const startCrawlMock = vi.mocked(startCrawl);
  const getRunStateMock = vi.mocked(getRunState);
  const fetchCrawledPagesMock = vi.mocked(fetchCrawledPages);
  const localCrawlMock = vi.mocked(localCrawl);
  const isCrawl4aiConfiguredMock = vi.mocked(isCrawl4aiConfigured);
  const startCrawl4aiMock = vi.mocked(startCrawl4ai);
  const getCrawl4aiTaskMock = vi.mocked(getCrawl4aiTask);
  const lookupMock = vi.mocked(lookup);

  const originalSecret = process.env.CRON_SECRET;

  const authed = (path: string) =>
    new Request(`https://ciele.app/api/cron/${path}`, {
      headers: { authorization: "Bearer cron-secret" },
    });

  const sweep = () => sweepRecrawls(authed("sweep-recrawls"));
  const finalize = () => finalizeCrawls(authed("finalize-crawls"));

  /**
   * A Website Source that is already due for a re-crawl (ready, crawled long
   * enough ago that its weekly cadence has elapsed) with one previously ingested
   * Concept standing in for the live knowledge a refresh must not lose.
   */
  async function seedDueSource(name: string, config: WebsiteSourceConfig) {
    const assistant = await getMockDb().createAssistant(DEMO_ORG.id, { title: name });
    const db = getMockDb();
    const collection = await db.createCollection(assistant.id, { name });
    const source = await db.createSource({
      collectionId: collection.id,
      name,
      kind: "website",
      config,
      recrawlSchedule: "weekly",
    });
    await db.createConcept({
      collectionId: collection.id,
      sourceId: source.id,
      path: "web/previous.md",
      frontmatter: { type: "Web Page", title: "Previous", timestamp: "2026-01-01T00:00:00.000Z" },
      body: "Previously ingested knowledge.",
    });
    await db.updateSource(source.id, {
      status: "ready",
      lastCrawledAt: "2026-01-01T00:00:00.000Z",
    });
    return { assistantId: assistant.id, collectionId: collection.id, sourceId: source.id };
  }

  const page = (path: string) => ({
    url: `https://x.edu/${path}`,
    title: `Page ${path}`,
    text: `Content ${path}.`,
  });

  beforeEach(() => {
    // A fresh store per test so the sweep only sees the Sources this test seeds.
    (globalThis as { __agentHubMock?: unknown }).__agentHubMock = undefined;
    process.env.CRON_SECRET = "cron-secret";
    isApifyConfiguredMock.mockReset();
    startCrawlMock.mockReset();
    getRunStateMock.mockReset();
    fetchCrawledPagesMock.mockReset();
    localCrawlMock.mockReset();
    isCrawl4aiConfiguredMock.mockReset();
    startCrawl4aiMock.mockReset();
    getCrawl4aiTaskMock.mockReset();
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    // The seeded demo Website Source is due on a weekly cadence — drop it so the
    // sweep claims only what each test creates.
    void getMockDb().deleteSource("src-alex-website");
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it("runs a scheduled Local re-crawl through the shared start + finalize lifecycle", async () => {
    const db = getMockDb();
    const { collectionId, sourceId } = await seedDueSource("sched-local", {
      url: "https://x.edu",
      crawlerProvider: "local",
    });
    isApifyConfiguredMock.mockReturnValue(true);
    localCrawlMock.mockResolvedValue([page("a"), page("b")]);

    const sweepResponse = await sweep();
    await expect(sweepResponse.json()).resolves.toMatchObject({
      recrawls: { swept: 1, launched: 1 },
    });
    // Provider resolved + persisted by the shared start op; the previous Concept
    // stays live while the replacement crawl runs.
    const afterStart = await db.getSource(sourceId);
    expect(afterStart?.status).toBe("processing");
    expect(afterStart?.config).toMatchObject({
      resolvedCrawlerProvider: "local",
      crawlRunId: LOCAL_CRAWL_RUN,
    });
    expect(await db.listConcepts(collectionId)).toHaveLength(1);

    await finalize();

    expect(localCrawlMock).toHaveBeenCalledOnce();
    expect((await db.getSource(sourceId))?.status).toBe("ready");
    const concepts = await db.listConcepts(collectionId);
    expect(concepts).toHaveLength(2);
    expect(concepts.every((c) => c.frontmatter.type === "Web Page")).toBe(true);
    expect(concepts.some((c) => c.path === "web/previous.md")).toBe(false);
  });

  it("runs a scheduled Crawl4AI re-crawl through the shared lifecycle", async () => {
    const db = getMockDb();
    const { collectionId, sourceId } = await seedDueSource("sched-crawl4ai", {
      url: "https://x.edu",
      crawlerProvider: "crawl4ai",
    });
    isCrawl4aiConfiguredMock.mockReturnValue(true);
    startCrawl4aiMock.mockResolvedValue({ runId: "task-1", datasetId: "task-1" });
    getCrawl4aiTaskMock.mockResolvedValue({
      status: "COMPLETED",
      results: [
        { url: "https://x.edu/a", markdown: "Alpha", metadata: { title: "A" } },
        { url: "https://x.edu/b", markdown: "Beta", metadata: { title: "B" } },
      ],
    });

    await sweep();
    expect(startCrawl4aiMock).toHaveBeenCalledOnce();
    expect((await db.getSource(sourceId))?.config).toMatchObject({
      resolvedCrawlerProvider: "crawl4ai",
      crawlRunId: "task-1",
    });

    await finalize();

    expect(getRunStateMock).not.toHaveBeenCalled();
    expect((await db.getSource(sourceId))?.status).toBe("ready");
    expect(await db.listConcepts(collectionId)).toHaveLength(2);
  });

  it("runs a scheduled Apify re-crawl through the shared lifecycle", async () => {
    const db = getMockDb();
    const { collectionId, sourceId } = await seedDueSource("sched-apify", {
      url: "https://x.edu",
      crawlerProvider: "apify",
    });
    isApifyConfiguredMock.mockReturnValue(true);
    startCrawlMock.mockResolvedValue({ runId: "run-1", datasetId: "ds-1" });
    getRunStateMock.mockResolvedValue({ status: "SUCCEEDED", datasetId: "ds-1" });
    fetchCrawledPagesMock.mockResolvedValue([page("a")]);

    await sweep();
    expect(startCrawlMock).toHaveBeenCalledOnce();
    expect((await db.getSource(sourceId))?.config).toMatchObject({
      resolvedCrawlerProvider: "apify",
      crawlRunId: "run-1",
      crawlDatasetId: "ds-1",
    });

    await finalize();

    expect(localCrawlMock).not.toHaveBeenCalled();
    expect((await db.getSource(sourceId))?.status).toBe("ready");
    expect(await db.listConcepts(collectionId)).toHaveLength(1);
  });

  it("does not start a duplicate remote run when the sweep runs twice before finalization", async () => {
    const db = getMockDb();
    const { sourceId } = await seedDueSource("sched-idempotent", {
      url: "https://x.edu",
      crawlerProvider: "crawl4ai",
    });
    isCrawl4aiConfiguredMock.mockReturnValue(true);
    startCrawl4aiMock.mockResolvedValue({ runId: "task-1", datasetId: "task-1" });

    const first = await sweep();
    const second = await sweep();

    // The first sweep flips the Source to `processing`; the second finds nothing
    // due (the claim requires `ready`) so no second remote run is submitted.
    await expect(first.json()).resolves.toMatchObject({ recrawls: { swept: 1 } });
    await expect(second.json()).resolves.toMatchObject({ recrawls: { swept: 0 } });
    expect(startCrawl4aiMock).toHaveBeenCalledOnce();
    expect((await db.getSource(sourceId))?.config).toMatchObject({
      crawlRunId: "task-1",
    });
  });

  it("finalizes under the provider resolved at schedule time even when the config changes first", async () => {
    const db = getMockDb();
    const { collectionId, sourceId } = await seedDueSource("sched-config-change", {
      url: "https://x.edu",
      crawlerProvider: "local",
    });
    isApifyConfiguredMock.mockReturnValue(true);
    localCrawlMock.mockResolvedValue([page("a")]);

    await sweep();
    expect((await db.getSource(sourceId))?.config.resolvedCrawlerProvider).toBe("local");

    // An admin re-points the configured provider between schedule and finalize.
    const started = await db.getSource(sourceId);
    await db.updateSource(sourceId, {
      config: { ...started!.config, crawlerProvider: "apify" },
    });

    await finalize();

    // The run stays on the provider it started with; the changed config only
    // affects the *next* crawl.
    expect(localCrawlMock).toHaveBeenCalledOnce();
    expect(getRunStateMock).not.toHaveBeenCalled();
    expect((await db.getSource(sourceId))?.status).toBe("ready");
    expect(await db.listConcepts(collectionId)).toHaveLength(1);
  });

  it("keeps the previous ready Concepts and raises a crawl Alert when a scheduled refresh fails", async () => {
    const db = getMockDb();
    const { collectionId, sourceId } = await seedDueSource("sched-failed", {
      url: "https://x.edu",
      crawlerProvider: "local",
    });
    isApifyConfiguredMock.mockReturnValue(true);
    // A refresh that returns no usable pages is a failure, not an empty success.
    localCrawlMock.mockResolvedValue([]);

    await sweep();
    await finalize();

    const source = await db.getSource(sourceId);
    expect(source?.status).toBe("error");
    expect(source?.error).toMatch(/no usable pages/i);
    // The live knowledge survives the failed refresh.
    const concepts = await db.listConcepts(collectionId);
    expect(concepts).toHaveLength(1);
    expect(concepts[0]?.path).toBe("web/previous.md");
    // Failures surface through the existing crawl Alert.
    const alerts = await db.listAlerts(DEMO_ORG.id);
    expect(alerts.some((a) => a.type === "crawl" && a.status === "active")).toBe(true);
  });
});
