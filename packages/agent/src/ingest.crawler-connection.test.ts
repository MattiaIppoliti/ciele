import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealSecret, type WebsiteSourceConfig } from "@agent-hub/core";
import { DEMO_ORG, getMockDb, type Db } from "@agent-hub/db";

vi.mock("./apify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./apify")>()),
  isApifyConfigured: vi.fn(),
  startCrawl: vi.fn(),
  getRunState: vi.fn(),
  fetchCrawledPages: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

import { lookup } from "node:dns/promises";
import {
  fetchCrawledPages,
  getRunState,
  isApifyConfigured,
  startCrawl,
} from "./apify";
import { beginWebsiteCrawl, finalizeWebsiteCrawl } from "./ingest";

/**
 * Settings → Crawling: an Organization's own Apify token. The crawl starts and
 * polls on that token, records that it did, and says so plainly when the token
 * disappears while the run is still going.
 */
describe("Website crawl on the Organization's own Apify account", () => {
  const startCrawlMock = vi.mocked(startCrawl);
  const getRunStateMock = vi.mocked(getRunState);
  const fetchCrawledPagesMock = vi.mocked(fetchCrawledPages);
  const isApifyConfiguredMock = vi.mocked(isApifyConfigured);

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
    vi.stubEnv("APP_ENCRYPTION_KEY", "test-key");
    startCrawlMock.mockReset();
    getRunStateMock.mockReset();
    fetchCrawledPagesMock.mockReset();
    isApifyConfiguredMock.mockReset();
    isApifyConfiguredMock.mockReturnValue(false);
    vi.mocked(lookup).mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as never);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await getMockDb().deleteCrawlerConnection(DEMO_ORG.id, "apify");
  });

  it("starts and polls on the org token even with no platform token", async () => {
    const db = getMockDb();
    await db.setCrawlerConnection(DEMO_ORG.id, {
      provider: "apify",
      encryptedToken: sealSecret("apify_api_org"),
      tokenHint: "…_org",
    });
    // A small static Automatic crawl: Local without the org's account, Apify
    // with it, because the Organization is the one paying.
    const { assistantId, collectionId, source } = await seed(db, "org-apify", {
      url: "https://x.edu",
    });
    startCrawlMock.mockResolvedValue({ runId: "run-1", datasetId: "ds-1" });

    await beginWebsiteCrawl({ db, sourceId: source.id });

    expect(startCrawlMock).toHaveBeenCalledWith(
      "https://x.edu",
      expect.any(Object),
      "apify_api_org"
    );
    expect((await db.getSource(source.id))?.config).toMatchObject({
      resolvedCrawlerProvider: "apify",
      crawlCredential: "organization",
    });

    getRunStateMock.mockResolvedValue({ status: "SUCCEEDED", datasetId: "ds-1" });
    fetchCrawledPagesMock.mockResolvedValue([
      { url: "https://x.edu", title: "Home", text: "Welcome" },
    ]);
    const status = await finalizeWebsiteCrawl({
      db,
      assistantId,
      collectionId,
      sourceId: source.id,
    });

    expect(status).toBe("ready");
    expect(getRunStateMock).toHaveBeenCalledWith("run-1", "apify_api_org");

    // Metered as the organization's own work, never against the platform's
    // scraping allowance.
    const scraping = (
      await db.getOrgUsageMeters(
        DEMO_ORG.id,
        new Date(Date.now() - 60_000).toISOString(),
        new Date(Date.now() + 60_000).toISOString()
      )
    ).filter((row) => row.resource === "scraping" && row.provider === "apify");
    expect(scraping).toEqual([
      expect.objectContaining({ credentialKind: "api_key", units: 1 }),
    ]);
  });

  it("records a platform crawl when the org has no token of its own", async () => {
    const db = getMockDb();
    isApifyConfiguredMock.mockReturnValue(true);
    const { source } = await seed(db, "platform-apify", {
      url: "https://x.edu",
      crawlerProvider: "apify",
    });
    startCrawlMock.mockResolvedValue({ runId: "run-2", datasetId: "ds-2" });

    await beginWebsiteCrawl({ db, sourceId: source.id });

    expect(startCrawlMock).toHaveBeenCalledWith("https://x.edu", expect.any(Object));
    expect((await db.getSource(source.id))?.config.crawlCredential).toBe(
      "platform"
    );
  });

  it("names the removed token instead of polling with someone else's", async () => {
    const db = getMockDb();
    await db.setCrawlerConnection(DEMO_ORG.id, {
      provider: "apify",
      encryptedToken: sealSecret("apify_api_org"),
      tokenHint: "…_org",
    });
    const { assistantId, collectionId, source } = await seed(db, "removed", {
      url: "https://x.edu",
      crawlerProvider: "apify",
    });
    startCrawlMock.mockResolvedValue({ runId: "run-3", datasetId: "ds-3" });
    await beginWebsiteCrawl({ db, sourceId: source.id });

    await db.deleteCrawlerConnection(DEMO_ORG.id, "apify");
    const status = await finalizeWebsiteCrawl({
      db,
      assistantId,
      collectionId,
      sourceId: source.id,
    });

    expect(status).toBe("error");
    expect(getRunStateMock).not.toHaveBeenCalled();
    expect((await db.getSource(source.id))?.error).toMatch(/Settings → Crawling/);
  });
});
