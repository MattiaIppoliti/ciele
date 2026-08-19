import { beforeEach, describe, expect, it, vi } from "vitest";
import { type WebsiteSourceConfig } from "@agent-hub/core";
import { DEMO_ORG, getMockDb, type Db } from "@agent-hub/db";

// Mock only the network primitives of each provider. The Automatic policy, the
// shared begin/finalize lifecycle, the crawl-target validator, the pure
// Crawl4AI/Apify page mappings, and the mock DB's claim/lease semantics all run
// for real, so this exercises the provider matrix exactly as production wires
// it and asserts observable Source/Concept outcomes rather than provider
// internals.
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
import { CRAWL_FINALIZE_LEASE_MS, beginWebsiteCrawl, finalizeWebsiteCrawl, restartWebsiteCrawl } from "./ingest";

/**
 * The production-ready provider matrix (#110). The per-branch behaviors of the
 * three crawlers (routing, request/response mapping, alerts, telemetry, target
 * safety) are covered by the provider-specific suites from #103–#109. This suite
 * is the capstone: it drives the three providers through the *one* public crawl
 * lifecycle and asserts the user-visible outcome for each success path, each
 * failure mode, and the concurrent-finalizer contract, the matrix-level cover
 * those focused suites do not each repeat.
 */
describe("Website crawler provider matrix", () => {
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
    return {
      organizationId: assistant.organizationId,
      assistantId: assistant.id,
      collectionId: collection.id,
      source,
    };
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
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    // Every provider is available; explicit choices select which one runs.
    isApifyConfiguredMock.mockReturnValue(true);
    isCrawl4aiConfiguredMock.mockReturnValue(true);
  });

  /**
   * Arranges each provider's network primitives to succeed with `pages` pages,
   * and reports the resolved provider that a crawl should record. The three
   * arrangements are the only provider-specific code in this suite; everything
   * downstream is the shared lifecycle.
   */
  type ProviderCase = {
    provider: "local" | "crawl4ai" | "apify";
    label: string;
    config: WebsiteSourceConfig;
    arrangeSuccess: (pageCount: number) => void;
    expectRunId: string;
  };

  const pages = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      url: `https://x.edu/${i}`,
      title: `Page ${i}`,
      text: `Body of page ${i}.`,
    }));

  const cases: ProviderCase[] = [
    {
      provider: "local",
      label: "a controlled static site through Local",
      config: { url: "https://x.edu", crawlerProvider: "local" },
      arrangeSuccess: (count) => localCrawlMock.mockResolvedValue(pages(count)),
      expectRunId: LOCAL_CRAWL_RUN,
    },
    {
      provider: "crawl4ai",
      label: "a JavaScript-rendered site through Crawl4AI",
      config: { url: "https://x.edu", crawlerProvider: "crawl4ai", waitSecs: 2 },
      arrangeSuccess: (count) => {
        startCrawl4aiMock.mockResolvedValue({ runId: "task-1", datasetId: "task-1" });
        getCrawl4aiTaskMock.mockResolvedValue({
          status: "COMPLETED",
          results: pages(count).map((p) => ({
            url: p.url,
            markdown: p.text,
            metadata: { title: p.title },
          })),
        });
      },
      expectRunId: "task-1",
    },
    {
      provider: "apify",
      label: "a managed-capability crawl through Apify",
      config: { url: "https://x.edu", crawlerProvider: "apify", fetchFiles: true },
      arrangeSuccess: (count) => {
        startCrawlMock.mockResolvedValue({ runId: "run-1", datasetId: "ds-1" });
        getRunStateMock.mockResolvedValue({ status: "SUCCEEDED", datasetId: "ds-1" });
        fetchCrawledPagesMock.mockResolvedValue(pages(count));
      },
      expectRunId: "run-1",
    },
  ];

  describe("each provider succeeds through the shared lifecycle", () => {
    for (const testCase of cases) {
      it(`crawls ${testCase.label} and ingests one Concept per page`, async () => {
        const db = getMockDb();
        const { assistantId, collectionId, source } = await seed(
          db,
          `matrix-${testCase.provider}`,
          testCase.config
        );
        testCase.arrangeSuccess(3);

        await beginWebsiteCrawl({ db, sourceId: source.id });

        const started = await db.getSource(source.id);
        expect(started?.status).toBe("processing");
        expect(started?.config.resolvedCrawlerProvider).toBe(testCase.provider);
        expect(started?.config.crawlRunId).toBe(testCase.expectRunId);

        const status = await finalizeWebsiteCrawl({
          db,
          assistantId,
          collectionId,
          sourceId: source.id,
        });

        expect(status).toBe("ready");
        const concepts = await db.listConcepts(collectionId);
        expect(concepts).toHaveLength(3);
        expect(concepts.every((c) => c.sourceId === source.id)).toBe(true);
        expect(concepts.every((c) => c.frontmatter.type === "Web Page")).toBe(true);
        // No crawl Alert was raised for a clean success.
        const alerts = await db.listAlerts(DEMO_ORG.id);
        expect(alerts.some((a) => a.sourceKey === `website-source:${source.id}`)).toBe(false);
      });
    }
  });

  describe("thin-Local escalation to a browser provider (#402)", () => {
    it("escalates an empty Local crawl to Crawl4AI and ingests the browser result", async () => {
      const db = getMockDb();
      const { assistantId, collectionId, source } = await seed(db, "escalate-hit", {
        url: "https://x.edu",
        crawlerProvider: "local",
      });
      // Local (cheerio) sees a JS SPA as empty.
      localCrawlMock.mockResolvedValue([]);
      await beginWebsiteCrawl({ db, sourceId: source.id });

      // First finalize: Local returned nothing → escalate (no error, no ingest).
      startCrawl4aiMock.mockResolvedValue({ runId: "task-esc", datasetId: "task-esc" });
      const escalated = await finalizeWebsiteCrawl({
        db,
        assistantId,
        collectionId,
        sourceId: source.id,
      });
      expect(escalated).toBe("processing");
      expect(startCrawl4aiMock).toHaveBeenCalledOnce();
      const mid = await db.getSource(source.id);
      expect(mid?.config.resolvedCrawlerProvider).toBe("crawl4ai");
      expect(mid?.config.crawlEscalated).toBe(true);
      expect(mid?.config.crawlRunId).toBe("task-esc");
      expect(await db.listConcepts(collectionId)).toHaveLength(0);
      // A retry, not a failure: no crawl Alert is raised.
      const alerts = await db.listAlerts(DEMO_ORG.id);
      expect(alerts.some((a) => a.sourceKey === `website-source:${source.id}`)).toBe(false);

      // Second finalize: the browser crawl succeeds → ingest.
      getCrawl4aiTaskMock.mockResolvedValue({
        status: "COMPLETED",
        results: pages(2).map((p) => ({
          url: p.url,
          markdown: p.text,
          metadata: { title: p.title },
        })),
      });
      const done = await finalizeWebsiteCrawl({
        db,
        assistantId,
        collectionId,
        sourceId: source.id,
      });
      expect(done).toBe("ready");
      expect(await db.listConcepts(collectionId)).toHaveLength(2);
    });

    it("does not escalate an empty Local crawl when no browser provider is configured → error", async () => {
      const db = getMockDb();
      isApifyConfiguredMock.mockReturnValue(false);
      isCrawl4aiConfiguredMock.mockReturnValue(false);
      const { assistantId, collectionId, source } = await seed(db, "escalate-none", {
        url: "https://x.edu",
        crawlerProvider: "local",
      });
      localCrawlMock.mockResolvedValue([]);
      await beginWebsiteCrawl({ db, sourceId: source.id });

      const status = await finalizeWebsiteCrawl({
        db,
        assistantId,
        collectionId,
        sourceId: source.id,
      });
      expect(status).toBe("error");
      expect((await db.getSource(source.id))?.error).toMatch(/no usable pages/i);
      expect(startCrawl4aiMock).not.toHaveBeenCalled();
      expect(startCrawlMock).not.toHaveBeenCalled();
    });
  });

  describe("initial and manual re-crawl take the same provider lifecycle", () => {
    // Scheduled re-crawls are covered end-to-end in recrawl.scheduled.test.ts;
    // this asserts the third entry point (a manual re-crawl of a ready Source)
    // re-resolves and finalizes through the identical begin/finalize path.
    for (const testCase of cases) {
      it(`re-crawls a ready ${testCase.provider} Source through begin + finalize`, async () => {
        const db = getMockDb();
        const { assistantId, collectionId, source } = await seed(
          db,
          `manual-${testCase.provider}`,
          testCase.config
        );
        // Land it ready once via the initial crawl…
        testCase.arrangeSuccess(1);
        await beginWebsiteCrawl({ db, sourceId: source.id });
        await finalizeWebsiteCrawl({ db, assistantId, collectionId, sourceId: source.id });
        expect((await db.getSource(source.id))?.status).toBe("ready");

        // …then a manual re-crawl replaces the pages through the same lifecycle.
        testCase.arrangeSuccess(2);
        await restartWebsiteCrawl({ db, sourceId: source.id });
        const restarted = await db.getSource(source.id);
        expect(restarted?.status).toBe("processing");
        expect(restarted?.config.resolvedCrawlerProvider).toBe(testCase.provider);

        const status = await finalizeWebsiteCrawl({
          db,
          assistantId,
          collectionId,
          sourceId: source.id,
        });
        expect(status).toBe("ready");
        expect(await db.listConcepts(collectionId)).toHaveLength(2);
      });
    }
  });

  describe("failure modes each land a distinct user-visible state", () => {
    // Runs an explicit-Crawl4AI crawl to `processing`, then arranges the poll.
    async function beginCrawl4ai(db: Db, name: string) {
      const seeded = await seed(db, name, {
        url: "https://x.edu",
        crawlerProvider: "crawl4ai",
      });
      startCrawl4aiMock.mockResolvedValue({ runId: "task-1", datasetId: "task-1" });
      await beginWebsiteCrawl({ db, sourceId: seeded.source.id });
      return seeded;
    }

    const activeCrawlAlert = (db: Db, sourceId: string) =>
      db
        .listAlerts(DEMO_ORG.id)
        .then((alerts) =>
          alerts.filter(
            (a) => a.sourceKey === `website-source:${sourceId}` && a.status === "active"
          )
        );

    it("terminal remote failure → Source error + crawl Alert", async () => {
      const db = getMockDb();
      const { assistantId, collectionId, source } = await beginCrawl4ai(db, "fail-terminal");
      getCrawl4aiTaskMock.mockResolvedValue({
        status: "FAILED",
        results: [],
        error: "browser crashed",
      });

      const status = await finalizeWebsiteCrawl({ db, assistantId, collectionId, sourceId: source.id });

      expect(status).toBe("error");
      expect((await db.getSource(source.id))?.error).toMatch(/browser crashed/i);
      expect(await activeCrawlAlert(db, source.id)).toHaveLength(1);
      expect(await db.listConcepts(collectionId)).toHaveLength(0);
    });

    it("worker timeout during polling → Source error + crawl Alert", async () => {
      const db = getMockDb();
      const { assistantId, collectionId, source } = await beginCrawl4ai(db, "fail-timeout");
      const timeout = new Error("The operation timed out.");
      timeout.name = "TimeoutError";
      getCrawl4aiTaskMock.mockRejectedValue(timeout);

      const status = await finalizeWebsiteCrawl({ db, assistantId, collectionId, sourceId: source.id });

      expect(status).toBe("error");
      expect((await db.getSource(source.id))?.error).toMatch(/timed out/i);
      expect(await activeCrawlAlert(db, source.id)).toHaveLength(1);
      expect(await db.listConcepts(collectionId)).toHaveLength(0);
    });

    it("a completed task with only malformed page items → error (no usable pages)", async () => {
      const db = getMockDb();
      const { assistantId, collectionId, source } = await beginCrawl4ai(db, "fail-malformed");
      // The real mapCrawl4aiPages runs: worker-failed and shapeless items are
      // dropped, leaving nothing usable, treated as an error, never a success.
      getCrawl4aiTaskMock.mockResolvedValue({
        status: "COMPLETED",
        results: [
          { url: "https://x.edu/a", markdown: "text", success: false },
          null as never,
          { markdown: "   " },
        ],
      });

      const status = await finalizeWebsiteCrawl({ db, assistantId, collectionId, sourceId: source.id });

      expect(status).toBe("error");
      expect((await db.getSource(source.id))?.error).toMatch(/no usable pages/i);
      expect(await activeCrawlAlert(db, source.id)).toHaveLength(1);
    });

    it("empty result → error (no usable pages)", async () => {
      const db = getMockDb();
      const { assistantId, collectionId, source } = await beginCrawl4ai(db, "fail-empty");
      getCrawl4aiTaskMock.mockResolvedValue({ status: "COMPLETED", results: [] });

      const status = await finalizeWebsiteCrawl({ db, assistantId, collectionId, sourceId: source.id });

      expect(status).toBe("error");
      expect((await db.getSource(source.id))?.error).toMatch(/no usable pages/i);
    });

    it("still-running task → stays processing (no error, no ingest)", async () => {
      const db = getMockDb();
      const { assistantId, collectionId, source } = await beginCrawl4ai(db, "still-running");
      getCrawl4aiTaskMock.mockResolvedValue({ status: "PROCESSING", results: [] });

      const status = await finalizeWebsiteCrawl({ db, assistantId, collectionId, sourceId: source.id });

      expect(status).toBe("processing");
      expect(await db.listConcepts(collectionId)).toHaveLength(0);
      expect(await activeCrawlAlert(db, source.id)).toHaveLength(0);
    });

    it("unavailable provider on an explicit choice → Source error at start", async () => {
      const db = getMockDb();
      const { source } = await seed(db, "unavailable", {
        url: "https://x.edu",
        crawlerProvider: "crawl4ai",
      });
      isCrawl4aiConfiguredMock.mockReturnValue(false);
      startCrawl4aiMock.mockRejectedValue(
        new Error("CRAWL4AI_BASE_URL and CRAWL4AI_API_TOKEN must be set")
      );

      await beginWebsiteCrawl({ db, sourceId: source.id });

      expect((await db.getSource(source.id))?.status).toBe("error");
    });

    it("Automatic with no compatible provider → Source error, nothing started", async () => {
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
    });

    it("an unsafe target → Source error before any provider is invoked", async () => {
      const db = getMockDb();
      const { source } = await seed(db, "unsafe", {
        url: "http://127.0.0.1/admin",
        crawlerProvider: "crawl4ai",
      });

      await beginWebsiteCrawl({ db, sourceId: source.id });

      expect(startCrawl4aiMock).not.toHaveBeenCalled();
      const stored = await db.getSource(source.id);
      expect(stored?.status).toBe("error");
      expect(stored?.config.resolvedCrawlerProvider).toBeUndefined();
    });
  });

  it("concurrent client poll and cron finalization ingest a crawl exactly once", async () => {
    // The real production race: the cron atomically claims a batch under its own
    // worker id and finalizes with that lease, while a still-open Knowledge tab
    // polls the same Source. Only the lease holder may ingest, no duplicate
    // Concepts, no double status flip.
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "concurrent", {
      url: "https://x.edu",
      crawlerProvider: "crawl4ai",
    });
    startCrawl4aiMock.mockResolvedValue({ runId: "task-1", datasetId: "task-1" });
    await beginWebsiteCrawl({ db, sourceId: source.id });
    getCrawl4aiTaskMock.mockResolvedValue({
      status: "COMPLETED",
      results: [{ url: "https://x.edu/a", markdown: "Alpha", metadata: { title: "A" } }],
    });

    // The cron claims the Source (as the sweep route does) before finalizing.
    const now = new Date();
    const cronWorkerId = "cron-finalize-crawls-abc";
    const claimed = await db.claimProcessingCrawlSources({
      workerId: cronWorkerId,
      now: now.toISOString(),
      staleBefore: new Date(now.getTime() - CRAWL_FINALIZE_LEASE_MS).toISOString(),
      limit: 5,
    });
    expect(claimed.map((c) => c.sourceId)).toContain(source.id);

    const [cronStatus, clientStatus] = await Promise.all([
      // Cron passes its pre-acquired lease.
      finalizeWebsiteCrawl({ db, assistantId, collectionId, sourceId: source.id, claimedWorkerId: cronWorkerId }),
      // Client polls without a lease and must yield to the cron's claim.
      finalizeWebsiteCrawl({ db, assistantId, collectionId, sourceId: source.id }),
    ]);

    expect(cronStatus).toBe("ready");
    expect(clientStatus).toBe("processing");
    expect(await db.listConcepts(collectionId)).toHaveLength(1);
  });
});
