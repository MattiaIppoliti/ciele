import { afterEach, describe, expect, it, vi } from "vitest";
import { getMockDb, DEMO_ORG, type Db } from "@agent-hub/db";
import { runIngestJob } from "./jobs";

/**
 * Issue #190 (spec #189): re-ingesting a file/text Source replaces its
 * Concepts atomically (create-then-delete), with the same guarantees the
 * website-crawl finalizer already has — a failed re-ingest keeps last-good
 * knowledge, a successful one leaves exactly the new set. These tests assert
 * observable Source status + resulting Concepts at the Ingestion Job seam
 * (`runIngestJob`, the path both the re-process and retry actions enqueue),
 * never internal call ordering. Failures are injected at the existing
 * persist/embed boundary (`db.saveChunks`). Runs offline: no Provider
 * Connections → naive enrichment + lexical embeddings.
 */
describe("runIngestJob — atomic knowledge replacement on re-ingest", () => {
  async function seed(db: Db, name: string) {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: name });
    const collection = await db.createCollection(assistant.id, { name });
    const source = await db.createSource({
      collectionId: collection.id,
      name,
      kind: "text",
      config: {},
    });
    return { assistantId: assistant.id, collectionId: collection.id, source };
  }

  /** A previously-ingested Concept standing in for the Source's last-good knowledge. */
  const seedPriorConcept = (db: Db, collectionId: string, sourceId: string, path: string) =>
    db.createConcept({
      collectionId,
      sourceId,
      path,
      frontmatter: { type: "Document", title: path },
      body: "Previously ingested knowledge.",
    });

  const jobFor = (assistantId: string, collectionId: string, sourceId: string) => ({
    kind: "ingest_source" as const,
    assistantId,
    collectionId,
    sourceId,
    rawText: "Fresh content for the replacement set.",
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves the prior Concepts when the re-ingest fails partway", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "reingest-midfail");
    const prior = await seedPriorConcept(db, collectionId, source.id, "docs/previous.md");

    vi.spyOn(db, "saveChunks").mockRejectedValue(new Error("embeddings provider timeout"));

    await runIngestJob(jobFor(assistantId, collectionId, source.id), { db });

    const stored = await db.getSource(source.id);
    expect(stored?.status).toBe("error");
    expect(stored?.error).toMatch(/embeddings provider timeout/i);

    // The last-good knowledge survives, with no partial new set left behind:
    // exactly the prior Concept remains.
    const concepts = await db.listConcepts(collectionId);
    expect(concepts).toHaveLength(1);
    expect(concepts[0]?.id).toBe(prior.id);

    // The failure surfaces through the existing ingestion Alert.
    const alerts = await db.listAlerts(DEMO_ORG.id);
    expect(
      alerts.some(
        (a) => a.type === "ingestion" && a.status === "active" && a.title.includes("reingest-midfail")
      )
    ).toBe(true);
  });

  it("atomically replaces the prior set on a successful re-ingest", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "reingest-success");
    const prior = await seedPriorConcept(db, collectionId, source.id, "docs/previous.md");

    // While the new set is being persisted, the prior Concept must still be
    // live (searchable) — replacement is create-then-delete, never a hole.
    const realSaveChunks = db.saveChunks.bind(db);
    vi.spyOn(db, "saveChunks").mockImplementation(async (chunks) => {
      const during = await db.listConcepts(collectionId);
      expect(during.some((c) => c.id === prior.id)).toBe(true);
      return realSaveChunks(chunks);
    });

    await runIngestJob(jobFor(assistantId, collectionId, source.id), { db });

    expect((await db.getSource(source.id))?.status).toBe("ready");
    const concepts = await db.listConcepts(collectionId);
    // Old gone, exactly the new set remains.
    expect(concepts.length).toBeGreaterThanOrEqual(1);
    expect(concepts.some((c) => c.id === prior.id)).toBe(false);
    expect(concepts.every((c) => c.sourceId === source.id)).toBe(true);
  });

  it("retires debris from an interrupted earlier attempt without duplicating", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "reingest-retry");
    // Last-good knowledge plus debris a crashed earlier attempt left behind:
    // both are attached to the Source, so the retry must capture and retire both.
    const prior = await seedPriorConcept(db, collectionId, source.id, "docs/previous.md");
    const debris = await seedPriorConcept(db, collectionId, source.id, "docs/partial-new.md");

    await runIngestJob(jobFor(assistantId, collectionId, source.id), { db });

    expect((await db.getSource(source.id))?.status).toBe("ready");
    const concepts = await db.listConcepts(collectionId);
    expect(concepts.some((c) => c.id === prior.id)).toBe(false);
    expect(concepts.some((c) => c.id === debris.id)).toBe(false);
    expect(concepts.length).toBeGreaterThanOrEqual(1);
  });

  it("ingests a new Source (no prior Concepts) unchanged", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "reingest-initial");

    await runIngestJob(jobFor(assistantId, collectionId, source.id), { db });

    expect((await db.getSource(source.id))?.status).toBe("ready");
    const concepts = await db.listConcepts(collectionId);
    expect(concepts.length).toBeGreaterThanOrEqual(1);
    expect(concepts.every((c) => c.sourceId === source.id)).toBe(true);
  });

  it("auto-resolves the ingestion Alert when a later re-ingest succeeds", async () => {
    const db = getMockDb();
    const { assistantId, collectionId, source } = await seed(db, "reingest-recover");
    await seedPriorConcept(db, collectionId, source.id, "docs/previous.md");

    const failing = vi
      .spyOn(db, "saveChunks")
      .mockRejectedValue(new Error("embeddings provider timeout"));
    await runIngestJob(jobFor(assistantId, collectionId, source.id), { db });
    failing.mockRestore();

    await runIngestJob(jobFor(assistantId, collectionId, source.id), { db });

    expect((await db.getSource(source.id))?.status).toBe("ready");
    const alerts = await db.listAlerts(DEMO_ORG.id);
    expect(
      alerts.some(
        (a) => a.type === "ingestion" && a.status === "active" && a.title.includes("reingest-recover")
      )
    ).toBe(false);
  });
});
