import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMockDb, DEMO_ORG, type Db } from "@agent-hub/db";

// Mock only the network primitives; the shared finalizer, the mock DB's
// claim/lease semantics, and the create-then-delete replacement all run for real.
vi.mock("./apify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./apify")>()),
  getRunState: vi.fn(),
  fetchCrawledPages: vi.fn(),
  fetchCrawledPageBatch: vi.fn(),
}));
vi.mock("./graph-worker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./graph-worker")>()),
  isGraphWorkerConfigured: () => true,
}));

import {
  getRunState,
  fetchCrawledPages,
  fetchCrawledPageBatch,
} from "./apify";
import { finalizeWebsiteCrawl, ingestSource } from "./ingest";

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
  const fetchPageBatchMock = vi.mocked(fetchCrawledPageBatch);

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
    fetchPageBatchMock.mockReset();
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

  it("keeps retrieval on one complete generation throughout a re-crawl", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(
      db,
      "atomic-visible-generation"
    );
    const prior = await seedPriorConcept(
      db,
      collectionId,
      source.id,
      "web/previous.md"
    );
    await db.setSourceAssistantLinks(source.id, [assistantId]);
    await db.saveChunks([
      {
        conceptId: prior.id,
        collectionId,
        sourceId: source.id,
        content: "Previously ingested knowledge.",
        embedding: null,
      },
    ]);
    getRunStateMock.mockResolvedValue({ status: "SUCCEEDED", datasetId: "ds_1" });
    fetchPagesMock.mockResolvedValue([page("a"), page("b")]);

    let releaseSecondPage!: () => void;
    let secondPageStarted!: () => void;
    const blocked = new Promise<void>((resolve) => {
      secondPageStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseSecondPage = resolve;
    });
    const realSaveChunks = db.saveChunks.bind(db);
    let newPageSaves = 0;
    vi.spyOn(db, "saveChunks").mockImplementation(async (chunks) => {
      newPageSaves += 1;
      if (newPageSaves === 2) {
        secondPageStarted();
        await release;
      }
      return realSaveChunks(chunks);
    });

    const finalizing = finalizeWebsiteCrawl({
      db,
      assistantId,
      collectionId,
      sourceId: source.id,
    });
    await blocked;

    const duringCutover = await db.searchChunks(assistantId, collectionId, {
      embedding: null,
      text: "Previously Content",
      limit: 10,
    });
    expect(duringCutover.map((hit) => hit.conceptId)).toEqual([prior.id]);

    releaseSecondPage();
    await expect(finalizing).resolves.toBe("ready");
    const afterCutover = await db.searchChunks(assistantId, collectionId, {
      embedding: null,
      text: "Previously Content",
      limit: 10,
    });
    expect(afterCutover.map((hit) => hit.conceptId)).not.toContain(prior.id);
    expect(afterCutover).toHaveLength(2);
  });

  it("projects only the generation that won the retrieval cutover", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(
      db,
      "atomic-graph-generation"
    );
    const prior = await seedPriorConcept(
      db,
      collectionId,
      source.id,
      "web/previous.md"
    );
    getRunStateMock.mockResolvedValue({ status: "SUCCEEDED", datasetId: "ds_1" });
    fetchPagesMock.mockResolvedValue([page("a"), page("b")]);

    let releaseSecondPage!: () => void;
    let secondPageStarted!: () => void;
    const blocked = new Promise<void>((resolve) => {
      secondPageStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseSecondPage = resolve;
    });
    const realSaveChunks = db.saveChunks.bind(db);
    let saves = 0;
    vi.spyOn(db, "saveChunks").mockImplementation(async (chunks) => {
      saves += 1;
      if (saves === 2) {
        secondPageStarted();
        await release;
      }
      return realSaveChunks(chunks);
    });
    const enqueue = vi.spyOn(db, "createBackgroundJob");

    const finalizing = finalizeWebsiteCrawl({
      db,
      assistantId,
      collectionId,
      sourceId: source.id,
    });
    await blocked;
    expect(enqueue).not.toHaveBeenCalled();

    releaseSecondPage();
    await expect(finalizing).resolves.toBe("ready");
    const activeIds = (await db.listConcepts(collectionId)).map(({ id }) => id);
    const graphPayloads = enqueue.mock.calls.map(([input]) => input.payload);
    expect(graphPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: "remove", conceptId: prior.id }),
        ...activeIds.map((conceptId) =>
          expect.objectContaining({ op: "ingest", conceptId })
        ),
      ])
    );
  });

  it("resumes a large crawl in bounded dataset batches before cutover", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(
      db,
      "atomic-paged-generation"
    );
    const prior = await seedPriorConcept(
      db,
      collectionId,
      source.id,
      "web/previous.md"
    );
    await db.updateSource(source.id, {
      config: { ...source.config, maxPages: 500 },
    });
    getRunStateMock.mockResolvedValue({ status: "SUCCEEDED", datasetId: "ds_1" });
    fetchPageBatchMock
      .mockResolvedValueOnce({ pages: [page("a")], nextOffset: 100 })
      .mockResolvedValueOnce({ pages: [page("b")], nextOffset: null });

    await expect(
      finalizeWebsiteCrawl({ db, assistantId, collectionId, sourceId: source.id })
    ).resolves.toBe("processing");
    expect((await db.listConcepts(collectionId)).map((c) => c.id)).toEqual([
      prior.id,
    ]);
    expect((await db.getSource(source.id))?.config).toMatchObject({
      crawlIngestCursor: "100",
      crawlIngestedPages: 1,
    });

    await expect(
      finalizeWebsiteCrawl({ db, assistantId, collectionId, sourceId: source.id })
    ).resolves.toBe("ready");
    const active = await db.listConcepts(collectionId);
    expect(active).toHaveLength(2);
    expect(active.map((concept) => concept.frontmatter.title).sort()).toEqual([
      "Page a",
      "Page b",
    ]);
    expect(fetchPageBatchMock.mock.calls.map((call) => call[2]?.offset)).toEqual([
      0,
      100,
    ]);
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

describe("large document resumability", () => {
  it("resumes a reclaimed generation without exposing a partial replacement", async () => {
    const db = getMockDb();
    const assistant = await db.createAssistant(DEMO_ORG.id, {
      title: "resumable-document",
    });
    const collection = await db.createCollection(assistant.id, {
      name: "resumable-document",
    });
    const source = await db.createSource({
      collectionId: collection.id,
      name: "large.pdf",
      kind: "file",
    });
    await db.setSourceAssistantLinks(source.id, [assistant.id]);
    const prior = await db.createConcept({
      collectionId: collection.id,
      sourceId: source.id,
      path: "docs/prior.md",
      frontmatter: { type: "Document", title: "prior" },
      body: "last good",
    });
    const rawText = "x".repeat(1_100_000);
    let renewals = 0;
    await expect(
      ingestSource({
        db,
        assistantId: assistant.id,
        collectionId: collection.id,
        source,
        rawText,
        connections: [],
        renewLease: () => ++renewals < 3,
      })
    ).resolves.toBe(false);
    expect((await db.listConcepts(collection.id)).map((concept) => concept.id)).toEqual([
      prior.id,
    ]);
    const interrupted = (await db.getSource(source.id))!;
    expect(interrupted.config.sourceIngestCursor).toBeGreaterThan(0);

    await expect(
      ingestSource({
        db,
        assistantId: assistant.id,
        collectionId: collection.id,
        source: interrupted,
        rawText,
        connections: [],
        renewLease: () => true,
      })
    ).resolves.toBe(true);
    const active = await db.listConcepts(collection.id);
    expect(active.some((concept) => concept.id === prior.id)).toBe(false);
    expect(active.length).toBeGreaterThan(1);
    expect((await db.getSource(source.id))?.config.sourceIngestCursor).toBeUndefined();
  });
});
