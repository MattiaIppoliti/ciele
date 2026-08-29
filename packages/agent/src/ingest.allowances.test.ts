import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageResource } from "@agent-hub/core";
import { getMockDb, DEMO_ORG, type Db } from "@agent-hub/db";

// DNS is stubbed so target validation passes offline (same as the provider
// matrix tests); only the crawler adapters are stubbed beyond that, because the
// gate under test must decide before any of them is reached.
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

vi.mock("./website-crawlers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./website-crawlers")>()),
  websiteCrawlerAdapter: vi.fn(),
  websiteCrawlerCapabilities: vi.fn(),
}));

import { lookup } from "node:dns/promises";
import {
  websiteCrawlerAdapter,
  websiteCrawlerCapabilities,
} from "./website-crawlers";
import {
  registerEnterpriseCapabilities,
  resetEnterpriseCapabilities,
} from "./ee";
import { beginWebsiteCrawl, embedConcept, restartWebsiteCrawl } from "./ingest";

/**
 * The two gates that stop platform-funded ingestion work when its allowance is
 * spent (#510), and, just as important, everything they must NOT stop.
 *
 * Runs offline: the mock Db, no Provider Connections, and stubbed crawler
 * adapters, so nothing here depends on a network or a model.
 */

const adapterMock = vi.mocked(websiteCrawlerAdapter);
const capabilitiesMock = vi.mocked(websiteCrawlerCapabilities);

/** A metering capability that blocks exactly the named resources. */
function blocking(...resources: UsageResource[]) {
  const seen: UsageResource[] = [];
  registerEnterpriseCapabilities({
    metering: {
      async checkUsage({ resource }) {
        seen.push(resource);
        return resources.includes(resource)
          ? {
              outcome: "block",
              message: "paused",
              resource,
              window: "week",
              resetsAt: "2026-08-01T00:00:00.000Z",
            }
          : { outcome: "allow" };
      },
      async getUsageLimits() {
        return null;
      },
    },
  });
  return seen;
}

async function seedWebsite(
  db: Db,
  name: string,
  config: Record<string, unknown> = {}
) {
  const assistant = await db.createAssistant(DEMO_ORG.id, { title: name });
  const collection = await db.createCollection(assistant.id, { name });
  const source = await db.createSource({
    collectionId: collection.id,
    name,
    kind: "website",
    config: { url: "https://x.edu", ...config },
  });
  return { assistantId: assistant.id, collectionId: collection.id, source };
}

const started = { runId: "run_1", datasetId: "ds_1" };

beforeEach(() => {
  vi.mocked(lookup).mockReset();
  vi.mocked(lookup).mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ] as never);
  adapterMock.mockReset();
  capabilitiesMock.mockReset();
  adapterMock.mockReturnValue({
    start: vi.fn(async () => started),
  } as unknown as ReturnType<typeof websiteCrawlerAdapter>);
  // Every crawler available, so provider resolution is decided by the Source's
  // own config rather than by the environment.
  capabilitiesMock.mockReturnValue({
    apifyConfigured: true,
    crawl4aiConfigured: true,
  });
});

afterEach(() => resetEnterpriseCapabilities());

describe("the scraping gate at crawl start", () => {
  it("refuses a metered crawl and says when it can run again", async () => {
    const db = getMockDb();
    blocking("scraping");
    const { source } = await seedWebsite(db, "blocked", {
      crawlerProvider: "apify",
    });

    const result = await beginWebsiteCrawl({ db, sourceId: source.id });

    expect(result.started).toBe(false);
    if (result.started) throw new Error("expected a refusal");
    expect(result.outcome).toBe("refused");
    expect(result.reason).toMatch(/scraping allowance/i);
    expect(adapterMock).not.toHaveBeenCalled();
  });

  it("leaves the Source's status and knowledge exactly as they were", async () => {
    // A spent budget is not a reason to downgrade knowledge that already works.
    const db = getMockDb();
    blocking("scraping");
    const { collectionId, source } = await seedWebsite(db, "ready-already", {
      crawlerProvider: "apify",
    });
    await db.updateSource(source.id, { status: "ready", error: "" });
    await db.createConcept({
      collectionId,
      sourceId: source.id,
      path: "kept.md",
      frontmatter: { type: "Web Page", title: "Kept" },
      body: "Previously crawled.",
    });

    await beginWebsiteCrawl({ db, sourceId: source.id });

    const after = await db.getSource(source.id);
    expect(after?.status).toBe("ready");
    expect(after?.error).toBe("");
    expect(await db.listConcepts(collectionId)).toHaveLength(1);
  });

  it("records the reason on the Source without touching its error field", async () => {
    const db = getMockDb();
    blocking("scraping");
    const { source } = await seedWebsite(db, "reason", {
      crawlerProvider: "apify",
    });

    await beginWebsiteCrawl({ db, sourceId: source.id });

    const after = await db.getSource(source.id);
    expect(after?.config.crawlBlockedReason).toMatch(/scraping allowance/i);
    expect(after?.error).toBe("");
  });

  it("never refuses a crawl that lands on the free local crawler", async () => {
    // Nothing to spend: the local crawler runs in-process and costs no credits,
    // so a spent budget must not stop it.
    const db = getMockDb();
    const seen = blocking("scraping");
    const { source } = await seedWebsite(db, "local", {
      crawlerProvider: "local",
    });

    const result = await beginWebsiteCrawl({ db, sourceId: source.id });

    expect(result.started).toBe(true);
    expect(seen).not.toContain("scraping");
    expect(adapterMock).toHaveBeenCalled();
  });

  it("lets a metered crawl through when the allowance is not spent", async () => {
    const db = getMockDb();
    blocking("ai", "embedding");
    const { source } = await seedWebsite(db, "allowed", {
      crawlerProvider: "apify",
    });

    expect((await beginWebsiteCrawl({ db, sourceId: source.id })).started).toBe(
      true
    );
  });

  it("clears a previous refusal once a crawl starts", async () => {
    const db = getMockDb();
    const { source } = await seedWebsite(db, "recovered", {
      crawlerProvider: "apify",
      crawlBlockedReason: "stale reason",
    });

    await beginWebsiteCrawl({ db, sourceId: source.id });

    expect((await db.getSource(source.id))?.config.crawlBlockedReason).toBeUndefined();
  });

  it("fails open when the usage check itself throws", async () => {
    const db = getMockDb();
    registerEnterpriseCapabilities({
      metering: {
        async checkUsage() {
          throw new Error("meter down");
        },
        async getUsageLimits() {
          return null;
        },
      },
    });
    const { source } = await seedWebsite(db, "meter-down", {
      crawlerProvider: "apify",
    });

    expect((await beginWebsiteCrawl({ db, sourceId: source.id })).started).toBe(
      true
    );
  });

  it("puts a refused re-crawl back on its previous status", async () => {
    // restartWebsiteCrawl marks the Source processing before starting; a refusal
    // must not leave it stuck there with no run behind it.
    const db = getMockDb();
    blocking("scraping");
    const { source } = await seedWebsite(db, "restart", {
      crawlerProvider: "apify",
    });
    await db.updateSource(source.id, { status: "ready", error: "" });

    const result = await restartWebsiteCrawl({ db, sourceId: source.id });

    expect(result.started).toBe(false);
    expect((await db.getSource(source.id))?.status).toBe("ready");
  });

  it("leaves a Source the scheduled sweep already claimed claimable again", async () => {
    // The sweep's claim flips the Source to `processing` BEFORE the start op
    // runs, so "restore what you found" would restore `processing`, and since
    // only a `ready` Source can be claimed, the re-crawl would lose its turn
    // permanently and the row would show a crawl that does not exist.
    const db = getMockDb();
    blocking("scraping");
    const { source } = await seedWebsite(db, "claimed", {
      crawlerProvider: "apify",
    });
    await db.updateSource(source.id, { status: "processing", error: "" });

    await restartWebsiteCrawl({ db, sourceId: source.id });

    expect((await db.getSource(source.id))?.status).toBe("ready");
  });

  it("leaves a genuine start failure in error, rather than rolling it back", async () => {
    // Only a refusal is rolled back. A target that does not resolve is a real
    // failure and must stay visible as one.
    const db = getMockDb();
    vi.mocked(lookup).mockRejectedValue(new Error("ENOTFOUND"));
    const { source } = await seedWebsite(db, "broken-target", {
      crawlerProvider: "apify",
    });
    await db.updateSource(source.id, { status: "ready", error: "" });

    const result = await restartWebsiteCrawl({ db, sourceId: source.id });

    expect(result.started).toBe(false);
    if (result.started) throw new Error("expected a failure");
    expect(result.outcome).toBe("failed");
    const after = await db.getSource(source.id);
    expect(after?.status).toBe("error");
    expect(after?.error).toBeTruthy();
  });
});

describe("the embedding gate at ingestion", () => {
  // The platform's own key, which is what makes an embedding platform-funded and
  // therefore gateable. Same lever the turn tests use.
  const PLATFORM_EMBED_KEY = "OPENAI_API_KEY";

  afterEach(() => {
    delete process.env[PLATFORM_EMBED_KEY];
  });

  async function seedConcept(db: Db, name: string) {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: name });
    const collection = await db.createCollection(assistant.id, { name });
    // Link-based retrieval (PRD #726/#733): the Concept answers through its
    // Source, and the link is what makes the Source this assistant's.
    const source = await db.createSource({
      collectionId: collection.id,
      name,
      kind: "text",
    });
    await db.setSourceAssistantLinks(source.id, [assistant.id]);
    const concept = await db.createConcept({
      collectionId: collection.id,
      sourceId: source.id,
      path: `${name}.md`,
      frontmatter: { type: "Web Page", title: name },
      body: "Body text to index.",
    });
    return { assistantId: assistant.id, collectionId: collection.id, concept };
  }

  it("does not ask the gate when nothing can embed anyway", async () => {
    // No Provider Connections: there is no embedding call to fund, so there is
    // nothing to check.
    const db = getMockDb();
    const seen = blocking("embedding");
    const { assistantId, collectionId, concept } = await seedConcept(db, "no-model");

    await embedConcept({
      db,
      assistantId,
      collectionId,
      conceptId: concept.id,
      title: "no-model",
      body: "Body text to index.",
      connections: [],
    });

    expect(seen).not.toContain("embedding");
  });

  it("refuses a platform-funded batch when the embedding allowance is spent", async () => {
    process.env[PLATFORM_EMBED_KEY] = "test-platform-key";
    const db = getMockDb();
    const seen = blocking("embedding");
    const { assistantId, collectionId, concept } = await seedConcept(db, "capped");

    await embedConcept({
      db,
      assistantId,
      collectionId,
      conceptId: concept.id,
      title: "capped",
      body: "Body text to index.",
      connections: [],
    });

    expect(seen).toContain("embedding");
    // The property that matters to a visitor: the content is still findable
    // without a vector, so an exhausted indexing budget degrades ranking rather
    // than losing the knowledge.
    const hits = await db.searchChunks(assistantId, collectionId, {
      embedding: null,
      text: "Body text",
    });
    expect(hits.length).toBeGreaterThan(0);
  });

  it("never refuses a batch the customer's own credentials would fund", async () => {
    const db = getMockDb();
    const seen = blocking("embedding");
    const { assistantId, collectionId, concept } = await seedConcept(db, "byok");

    await embedConcept({
      db,
      assistantId,
      collectionId,
      conceptId: concept.id,
      title: "byok",
      body: "Body text to index.",
      connections: [
        {
          id: "conn-1",
          organizationId: DEMO_ORG.id,
          provider: "openai",
          kind: "api_key",
          label: "Ours",
          apiKey: "sk-customer",
          config: {},
          createdAt: new Date().toISOString(),
        } as never,
      ],
    });

    expect(seen).not.toContain("embedding");
  });

  it("fails open when the embedding usage check throws", async () => {
    process.env[PLATFORM_EMBED_KEY] = "test-platform-key";
    const db = getMockDb();
    registerEnterpriseCapabilities({
      metering: {
        async checkUsage() {
          throw new Error("meter down");
        },
        async getUsageLimits() {
          return null;
        },
      },
    });
    const { assistantId, collectionId, concept } = await seedConcept(db, "open");

    // Reaching the embedding call at all is the assertion: a broken meter must
    // not stop knowledge from being indexed.
    await expect(
      embedConcept({
        db,
        assistantId,
        collectionId,
        conceptId: concept.id,
        title: "open",
        body: "Body text to index.",
        connections: [],
      })
    ).resolves.toBeUndefined();
  });
});
