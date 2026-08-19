import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMockDb, DEMO_ORG, type Db } from "@agent-hub/db";

// Mock only the network primitives; the shared finalizer, the mock DB's
// claim/lease semantics, and the create-then-delete replacement all run for real.
vi.mock("./apify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./apify")>()),
  getRunState: vi.fn(),
  fetchCrawledPages: vi.fn(),
}));

import { getRunState, fetchCrawledPages } from "./apify";
import { finalizeWebsiteCrawl } from "./ingest";

/**
 * Issue #162: a Website Source re-crawl replaces its Concepts atomically
 * (create-then-delete). These tests assert observable Source status + resulting
 * Concepts at the public finalize seam, never the finalizer's internal call
 * ordering, and inject failures at the existing persist/embed boundary
 * (`db.saveChunks`). Runs offline: no Provider Connections → lexical embeddings.
 */
describe("finalizeWebsiteCrawl, atomic knowledge replacement", () => {
  const getRunStateMock = vi.mocked(getRunState);
  const fetchPagesMock = vi.mocked(fetchCrawledPages);

  async function seed(db: Db, name: string) {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: name });
    const collection = await db.createCollection(assistant.id, { name });
    const source = await db.createSource({
      collectionId: collection.id,
      name,
      kind: "website",
      config: { url: "https://x.edu", crawlRunId: "run_1", crawlDatasetId: "ds_1" },
    });
    return { assistantId: assistant.id, collectionId: collection.id, source };
  }

  /** A previously-ingested Concept standing in for the Source's last-good knowledge. */
  const seedPriorConcept = (db: Db, collectionId: string, sourceId: string, path: string) =>
    db.createConcept({
      collectionId,
      sourceId,
      path,
      frontmatter: { type: "Web Page", title: path },
      body: "Previously ingested knowledge.",
    });

  const page = (p: string) => ({
    url: `https://x.edu/${p}`,
    title: `Page ${p}`,
    text: `Content ${p}.`,
  });

  beforeEach(() => {
    getRunStateMock.mockReset();
    fetchPagesMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("atomically replaces the prior Concepts on a fully successful re-crawl", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "atomic-success");
    const prior = await seedPriorConcept(db, collectionId, source.id, "web/previous.md");
    getRunStateMock.mockResolvedValue({ status: "SUCCEEDED", datasetId: "ds_1" });
    fetchPagesMock.mockResolvedValue([page("a"), page("b")]);

    const status = await finalizeWebsiteCrawl({
      db,
      assistantId,
      collectionId,
      sourceId: source.id,
    });

    expect(status).toBe("ready");
    expect((await db.getSource(source.id))?.status).toBe("ready");
    const concepts = await db.listConcepts(collectionId);
    // Old gone, new present, count correct.
    expect(concepts).toHaveLength(2);
    expect(concepts.some((c) => c.id === prior.id)).toBe(false);
    expect(concepts.some((c) => c.path === "web/previous.md")).toBe(false);
    expect(concepts.every((c) => c.frontmatter.type === "Web Page")).toBe(true);
  });

  it("preserves the prior Concepts and lands error+Alert when ingest fails partway", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "atomic-midfail");
    const prior = await seedPriorConcept(db, collectionId, source.id, "web/previous.md");
    getRunStateMock.mockResolvedValue({ status: "SUCCEEDED", datasetId: "ds_1" });
    fetchPagesMock.mockResolvedValue([page("a"), page("b")]);

    // Fail persisting the *second* page's chunks, a transient embed/persist error
    // mid-ingest, after the first new Concept has already been written.
    let saveCalls = 0;
    const realSaveChunks = db.saveChunks.bind(db);
    vi.spyOn(db, "saveChunks").mockImplementation(async (chunks) => {
      saveCalls += 1;
      if (saveCalls >= 2) throw new Error("embeddings provider timeout");
      return realSaveChunks(chunks);
    });

    const status = await finalizeWebsiteCrawl({
      db,
      assistantId,
      collectionId,
      sourceId: source.id,
    });

    expect(status).toBe("error");
    const stored = await db.getSource(source.id);
    expect(stored?.status).toBe("error");
    // Distinct from the empty-crawl / remote-failure copy.
    expect(stored?.error).toMatch(/embeddings provider timeout/i);

    // The last-good knowledge survives, with no partial new set left behind:
    // exactly the prior Concept remains, and it is never surfaced as ready.
    const concepts = await db.listConcepts(collectionId);
    expect(concepts).toHaveLength(1);
    expect(concepts[0]?.id).toBe(prior.id);
    expect(concepts[0]?.path).toBe("web/previous.md");

    // The mid-ingest failure surfaces through the existing crawl Alert.
    const alerts = await db.listAlerts(DEMO_ORG.id);
    expect(alerts.some((a) => a.type === "crawl" && a.status === "active")).toBe(true);
  });

  it("ingests an initial crawl (no prior Concepts) unchanged", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "atomic-initial");
    getRunStateMock.mockResolvedValue({ status: "SUCCEEDED", datasetId: "ds_1" });
    fetchPagesMock.mockResolvedValue([page("a")]);

    const status = await finalizeWebsiteCrawl({
      db,
      assistantId,
      collectionId,
      sourceId: source.id,
    });

    expect(status).toBe("ready");
    const concepts = await db.listConcepts(collectionId);
    expect(concepts).toHaveLength(1);
    expect(concepts[0]?.sourceId).toBe(source.id);
  });

  it("preserves prior Concepts on an empty crawl (regression guard)", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "atomic-empty");
    const prior = await seedPriorConcept(db, collectionId, source.id, "web/previous.md");
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
    const concepts = await db.listConcepts(collectionId);
    expect(concepts).toHaveLength(1);
    expect(concepts[0]?.id).toBe(prior.id);
  });

  it("preserves prior Concepts on a remotely-failed crawl (regression guard)", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "atomic-remotefail");
    const prior = await seedPriorConcept(db, collectionId, source.id, "web/previous.md");
    getRunStateMock.mockResolvedValue({ status: "FAILED", datasetId: "ds_1" });

    const status = await finalizeWebsiteCrawl({
      db,
      assistantId,
      collectionId,
      sourceId: source.id,
    });

    expect(status).toBe("error");
    expect(fetchPagesMock).not.toHaveBeenCalled();
    const concepts = await db.listConcepts(collectionId);
    expect(concepts).toHaveLength(1);
    expect(concepts[0]?.id).toBe(prior.id);
  });

  it("reconciles a partial new set from an interrupted attempt without duplicating", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "atomic-retry");
    // The last-good knowledge plus debris a crashed earlier attempt left behind:
    // both are attached to the Source, so the retry must capture and retire both.
    const prior = await seedPriorConcept(db, collectionId, source.id, "web/previous.md");
    const debris = await seedPriorConcept(db, collectionId, source.id, "web/partial-new.md");
    expect(await db.listConcepts(collectionId)).toHaveLength(2);

    getRunStateMock.mockResolvedValue({ status: "SUCCEEDED", datasetId: "ds_1" });
    fetchPagesMock.mockResolvedValue([page("a")]);

    const status = await finalizeWebsiteCrawl({
      db,
      assistantId,
      collectionId,
      sourceId: source.id,
    });

    expect(status).toBe("ready");
    const concepts = await db.listConcepts(collectionId);
    // Exactly the new set: the prior Concept and the leftover debris are gone,
    // and the new set is written once (no duplication).
    expect(concepts).toHaveLength(1);
    expect(concepts.some((c) => c.id === prior.id)).toBe(false);
    expect(concepts.some((c) => c.id === debris.id)).toBe(false);
    expect(concepts[0]?.frontmatter.title).toBe("Page a");
  });

  it("yields exactly one replacement under two concurrent finalizers", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "atomic-concurrent");
    const prior = await seedPriorConcept(db, collectionId, source.id, "web/previous.md");
    getRunStateMock.mockResolvedValue({ status: "SUCCEEDED", datasetId: "ds_1" });
    fetchPagesMock.mockResolvedValue([page("a")]);

    const statuses = await Promise.all([
      finalizeWebsiteCrawl({ db, assistantId, collectionId, sourceId: source.id }),
      finalizeWebsiteCrawl({ db, assistantId, collectionId, sourceId: source.id }),
    ]);

    expect(statuses).toContain("ready");
    // Only one finalizer ingested: the prior Concept is replaced by exactly one
    // new Concept, with no duplication from the second, deferred finalizer.
    const concepts = await db.listConcepts(collectionId);
    expect(concepts).toHaveLength(1);
    expect(concepts.some((c) => c.id === prior.id)).toBe(false);
  });
});
