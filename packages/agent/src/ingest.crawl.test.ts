import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMockDb, DEMO_ORG, type Db } from "@agent-hub/db";

// Mock only the network primitives; keep the pure status helpers real.
vi.mock("./apify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./apify")>()),
  getRunState: vi.fn(),
  fetchCrawledPages: vi.fn(),
}));

import { getRunState, fetchCrawledPages } from "./apify";
import { finalizeWebsiteCrawl } from "./ingest";

/**
 * The async-crawl finalize state machine — the core of moving crawls off the
 * request lifetime. Runs offline: the mock DB + no Provider Connections means
 * embeddings fall back to lexical, and the two Apify network calls are stubbed.
 */
describe("finalizeWebsiteCrawl", () => {
  const getRunStateMock = vi.mocked(getRunState);
  const fetchPagesMock = vi.mocked(fetchCrawledPages);

  async function seed(db: Db, name: string) {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: name });
    const collection = await db.createCollection(assistant.id, { name });
    const source = await db.createSource({
      collectionId: collection.id,
      name,
      kind: "website",
      config: {
        url: "https://x.edu",
        crawlRunId: "run_1",
        crawlDatasetId: "ds_1",
      },
    });
    return { assistantId: assistant.id, collectionId: collection.id, source };
  }

  beforeEach(() => {
    getRunStateMock.mockReset();
    fetchPagesMock.mockReset();
  });

  it("stays processing while the run is still running", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "still-running");
    getRunStateMock.mockResolvedValue({ status: "RUNNING", datasetId: "ds_1" });

    const status = await finalizeWebsiteCrawl({
      db,
      assistantId,
      collectionId,
      sourceId: source.id,
    });

    expect(status).toBe("processing");
    expect(fetchPagesMock).not.toHaveBeenCalled();
    expect(await db.listConcepts(collectionId)).toHaveLength(0);
  });

  it("ingests one Concept per page and marks ready on success", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "success");
    getRunStateMock.mockResolvedValue({ status: "SUCCEEDED", datasetId: "ds_1" });
    fetchPagesMock.mockResolvedValue([
      { url: "https://x.edu/a", title: "Page A", text: "Alpha content." },
      { url: "https://x.edu/b", title: "Page B", text: "Beta content." },
    ]);

    const status = await finalizeWebsiteCrawl({
      db,
      assistantId,
      collectionId,
      sourceId: source.id,
    });

    expect(status).toBe("ready");
    expect((await db.getSource(source.id))?.status).toBe("ready");
    const concepts = await db.listConcepts(collectionId);
    expect(concepts).toHaveLength(2);
    expect(concepts.every((c) => c.sourceId === source.id)).toBe(true);
  });

  it("marks error when a finished run has no pages", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "empty");
    getRunStateMock.mockResolvedValue({ status: "SUCCEEDED", datasetId: "ds_1" });
    fetchPagesMock.mockResolvedValue([]);

    const status = await finalizeWebsiteCrawl({
      db,
      assistantId,
      collectionId,
      sourceId: source.id,
    });

    expect(status).toBe("error");
    expect((await db.getSource(source.id))?.error).toMatch(/no usable pages/i);
  });

  it("marks error when the run failed", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "failed");
    getRunStateMock.mockResolvedValue({ status: "FAILED", datasetId: "ds_1" });

    const status = await finalizeWebsiteCrawl({
      db,
      assistantId,
      collectionId,
      sourceId: source.id,
    });

    expect(status).toBe("error");
    expect(fetchPagesMock).not.toHaveBeenCalled();
    expect((await db.getSource(source.id))?.status).toBe("error");
  });

  it("is a no-op once the source is already terminal", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "already-ready");
    await db.updateSource(source.id, { status: "ready" });

    const status = await finalizeWebsiteCrawl({
      db,
      assistantId,
      collectionId,
      sourceId: source.id,
    });

    expect(status).toBe("ready");
    expect(getRunStateMock).not.toHaveBeenCalled();
  });

  it("allows only one concurrent finalizer to ingest a crawl", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "claimed-once");
    getRunStateMock.mockResolvedValue({ status: "SUCCEEDED", datasetId: "ds_1" });
    fetchPagesMock.mockResolvedValue([
      { url: "https://x.edu/a", title: "Page A", text: "Alpha content." },
    ]);

    const statuses = await Promise.all([
      finalizeWebsiteCrawl({ db, assistantId, collectionId, sourceId: source.id }),
      finalizeWebsiteCrawl({ db, assistantId, collectionId, sourceId: source.id }),
    ]);

    expect(statuses).toContain("ready");
    expect(fetchPagesMock).toHaveBeenCalledTimes(1);
    expect(await db.listConcepts(collectionId)).toHaveLength(1);
  });

  it("stays processing when no run is attached yet", async () => {
    const db = getMockDb();
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "no-run" });
    const collection = await db.createCollection(assistant.id, { name: "no-run" });
    const source = await db.createSource({
      collectionId: collection.id,
      name: "no-run",
      kind: "website",
      config: { url: "https://x.edu" },
    });

    const status = await finalizeWebsiteCrawl({
      db,
      assistantId: assistant.id,
      collectionId: collection.id,
      sourceId: source.id,
    });

    expect(status).toBe("processing");
    expect(getRunStateMock).not.toHaveBeenCalled();
  });
});
