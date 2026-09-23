import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_ORG, getMockDb, resetMockDb } from "@agent-hub/db";
import type { Db } from "@agent-hub/db";
import {
  extractDocumentMemories,
  recordFailedExtraction,
} from "./extract-document-memories";

// Only the model call is faked, and the module is spread rather than replaced:
// a partial factory silently breaks other importers, and this path swallows
// several of its own outcomes, which would read as a passing test over code
// that never ran.
const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  getClassifierModel: vi.fn(),
}));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateObject: mocks.generateObject,
}));
vi.mock("./models", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./models")>()),
  getClassifierModel: mocks.getClassifierModel,
}));

const classifier = {
  model: {} as never,
  modelId: "claude-haiku-4-5",
  provider: "anthropic" as const,
  credentialKind: "platform" as const,
};

const BODY = [
  "Employees accrue 25 days of paid leave a year.",
  "Unused leave expires on 31 March.",
].join("\n\n");

async function seedDocument(db: Db, body = BODY) {
  const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Extractor" });
  const collection = await db.createCollection(assistant.id, { name: "Handbook" });
  const source = await db.createSource({
    collectionId: collection.id,
    name: "Handbook",
    kind: "text",
  });
  const document = await db.createConcept({
    collectionId: collection.id,
    sourceId: source.id,
    path: "handbook/leave.md",
    frontmatter: { type: "Document", title: "Leave policy" },
    body,
  });
  await db.saveChunks([
    {
      conceptId: document.id,
      collectionId: collection.id,
      sourceId: source.id,
      content: "Unused leave expires on 31 March.",
      embedding: null,
    },
  ]);
  return { assistant, collection, source, document };
}

const run = (fixture: Awaited<ReturnType<typeof seedDocument>>, db: Db) =>
  extractDocumentMemories({
    db,
    organizationId: DEMO_ORG.id,
    collectionId: fixture.collection.id,
    sourceId: fixture.source.id,
    documentPath: fixture.document.path,
  });

/**
 * This Source's *active* extraction alerts. `listAlerts` returns resolved ones
 * too (both adapters do), and the demo store seeds unrelated alerts of its
 * own, so both filters are the test's job.
 */
async function extractionAlerts(db: Db, sourceId: string) {
  const alerts = await db.listAlerts(DEMO_ORG.id);
  return alerts.filter(
    (alert) =>
      alert.status === "active" &&
      alert.sourceKey === `memory-extraction:${sourceId}`
  );
}

beforeEach(() => {
  resetMockDb();
  mocks.generateObject.mockReset();
  mocks.getClassifierModel.mockReset();
  mocks.getClassifierModel.mockReturnValue(classifier);
});

describe("extractDocumentMemories", () => {
  it("writes what the page said, with its quote, its chunk and its provenance", async () => {
    const db = getMockDb();
    const fixture = await seedDocument(db);
    mocks.generateObject.mockResolvedValue({
      object: {
        memories: [
          {
            text: "Leave expires at the end of March.",
            quote: "Unused leave expires on 31 March.",
          },
        ],
      },
      usage: { inputTokens: 700, outputTokens: 60 },
    });

    expect(await run(fixture, db)).toBe("extracted");

    const memories = await db.table("knowledgeMemories").list({
      sourceId: fixture.source.id,
      documentPath: fixture.document.path,
    });
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({
      text: "Leave expires at the end of March.",
      quote: "Unused leave expires on 31 March.",
      sourceCount: 1,
      conceptId: fixture.document.id,
      generatedBy: "knowledge-memory-extractor/claude-haiku-4-5",
    });
    // The quote was matched into its chunk, which is what makes "open the
    // chunk this came from" possible later.
    expect(memories[0]!.chunkId).not.toBeNull();

    const record = await db.getMemoryExtraction(
      fixture.source.id,
      fixture.document.path
    );
    expect(record).toMatchObject({ status: "done", memoryCount: 1, capped: false });
    expect(record?.bodyHash).toBeTruthy();
  });

  it("meters the call as memory extraction during ingestion", async () => {
    const db = getMockDb();
    const fixture = await seedDocument(db);
    mocks.generateObject.mockResolvedValue({
      object: { memories: [] },
      usage: { inputTokens: 700, outputTokens: 10 },
    });

    // The ledger write itself, because the Db exposes no read of it: what
    // matters is the row's stage and surface, and this is where they are set.
    const metered: unknown[] = [];
    const metering: Db = {
      ...db,
      recordAiUsage: async (rows) => void metered.push(...rows),
    };

    await extractDocumentMemories({
      db: metering,
      organizationId: DEMO_ORG.id,
      collectionId: fixture.collection.id,
      sourceId: fixture.source.id,
      documentPath: fixture.document.path,
    });

    expect(metered).toEqual([
      {
        organizationId: DEMO_ORG.id,
        assistantId: null,
        stage: "memory_extract",
        provider: "anthropic",
        modelId: "claude-haiku-4-5",
        credentialKind: "platform",
        inputTokens: 700,
        outputTokens: 10,
        surface: "ingestion",
      },
    ]);
  });

  it("refuses an invented fact before it is written", async () => {
    const db = getMockDb();
    const fixture = await seedDocument(db);
    mocks.generateObject.mockResolvedValue({
      object: {
        memories: [
          { text: "Leave rolls over forever.", quote: "Leave never expires." },
          {
            text: "Leave expires at the end of March.",
            quote: "Unused leave expires on 31 March.",
          },
        ],
      },
      usage: undefined,
    });

    await run(fixture, db);

    const memories = await db.table("knowledgeMemories").list({
      sourceId: fixture.source.id,
    });
    expect(memories.map((memory) => memory.text)).toEqual([
      "Leave expires at the end of March.",
    ]);
  });

  it("caps at twenty and records that it did", async () => {
    const db = getMockDb();
    const fixture = await seedDocument(db);
    mocks.generateObject.mockResolvedValue({
      object: {
        memories: Array.from({ length: 25 }, (_, i) => ({
          text: `Fact ${i}.`,
          quote: "Unused leave expires on 31 March.",
        })),
      },
      usage: undefined,
    });

    await run(fixture, db);

    expect(
      (await db.table("knowledgeMemories").list({ sourceId: fixture.source.id }))
        .length
    ).toBe(20);
    expect(
      (await db.getMemoryExtraction(fixture.source.id, fixture.document.path))
        ?.capped
    ).toBe(true);
  });

  it("makes no second call for an unchanged body", async () => {
    const db = getMockDb();
    const fixture = await seedDocument(db);
    mocks.generateObject.mockResolvedValue({
      object: {
        memories: [
          {
            text: "Leave expires at the end of March.",
            quote: "Unused leave expires on 31 March.",
          },
        ],
      },
      usage: undefined,
    });

    expect(await run(fixture, db)).toBe("extracted");
    expect(await run(fixture, db)).toBe("unchanged");
    // The hash gate: a weekly re-crawl of a site nobody edited pays once.
    expect(mocks.generateObject).toHaveBeenCalledTimes(1);
  });

  it("keeps a forgotten memory forgotten when the page says it again", async () => {
    const db = getMockDb();
    const fixture = await seedDocument(db);
    const forgotten = await db.table("knowledgeMemories").insert({
      organizationId: DEMO_ORG.id,
      collectionId: fixture.collection.id,
      sourceId: fixture.source.id,
      documentPath: fixture.document.path,
      text: "Leave expires at the end of March.",
      quote: "Unused leave expires on 31 March.",
      generatedBy: "knowledge-memory-extractor/earlier",
      generatedAt: new Date().toISOString(),
    });
    await db.table("knowledgeMemories").update(forgotten.id, {
      forgottenAt: new Date().toISOString(),
      forgetReason: "Wrong",
    });

    mocks.generateObject.mockResolvedValue({
      object: {
        memories: [
          {
            text: "Leave expires at the end of March.",
            quote: "Unused leave expires on 31 March.",
          },
        ],
      },
      usage: undefined,
    });
    await run(fixture, db);

    const after = await db.table("knowledgeMemories").get(forgotten.id);
    // Restated, so the count moved; still forgotten, so a wrong fact a Member
    // removed does not come back next Monday.
    expect(after?.sourceCount).toBe(2);
    expect(after?.forgottenAt).not.toBeNull();
    expect(after?.forgetReason).toBe("Wrong");
    expect(
      (await db.table("knowledgeMemories").list({ sourceId: fixture.source.id }))
        .length
    ).toBe(1);
  });

  it("leaves a live memory this extraction did not restate alone", async () => {
    const db = getMockDb();
    const fixture = await seedDocument(db);
    const earlier = await db.table("knowledgeMemories").insert({
      organizationId: DEMO_ORG.id,
      collectionId: fixture.collection.id,
      sourceId: fixture.source.id,
      documentPath: fixture.document.path,
      text: "Something the page used to say.",
      quote: "Unused leave expires on 31 March.",
      generatedBy: "knowledge-memory-extractor/earlier",
      generatedAt: new Date().toISOString(),
    });
    mocks.generateObject.mockResolvedValue({
      object: {
        memories: [
          { text: "A new fact.", quote: "Employees accrue 25 days of paid leave a year." },
        ],
      },
      usage: undefined,
    });

    await run(fixture, db);

    // Silence is not evidence: nothing auto-forgets it.
    expect((await db.table("knowledgeMemories").get(earlier.id))?.forgottenAt).toBeNull();
    expect(
      (await db.table("knowledgeMemories").list({ sourceId: fixture.source.id }))
        .length
    ).toBe(2);
  });

  it("records skipped_no_provider without an Alert and without a call", async () => {
    const db = getMockDb();
    const fixture = await seedDocument(db);
    mocks.getClassifierModel.mockReturnValue(null);

    expect(await run(fixture, db)).toBe("no_provider");
    expect(mocks.generateObject).not.toHaveBeenCalled();
    expect(
      (await db.getMemoryExtraction(fixture.source.id, fixture.document.path))
        ?.status
    ).toBe("skipped_no_provider");
    // No nagging about a feature nobody turned on. (The demo store carries
    // unrelated alerts of its own, so this asks about ours.)
    expect(await extractionAlerts(db, fixture.source.id)).toEqual([]);
  });

  it("answers no_document for a page that left the site", async () => {
    const db = getMockDb();
    const fixture = await seedDocument(db);
    await db.deleteConcept(fixture.document.id);
    expect(await run(fixture, db)).toBe("no_document");
    expect(mocks.generateObject).not.toHaveBeenCalled();
  });

  it("throws a model failure, so the ledger retries it", async () => {
    const db = getMockDb();
    const fixture = await seedDocument(db);
    mocks.generateObject.mockRejectedValue(new Error("upstream is down"));
    await expect(run(fixture, db)).rejects.toThrow("upstream is down");
    // Nothing recorded as done, so the retry re-extracts rather than skipping.
    expect(
      (await db.getMemoryExtraction(fixture.source.id, fixture.document.path))
        ?.status
    ).toBeUndefined();
  });
});

describe("recordFailedExtraction", () => {
  it("records the failure and raises one Alert for the Source", async () => {
    const db = getMockDb();
    const fixture = await seedDocument(db);
    await recordFailedExtraction({
      db,
      organizationId: DEMO_ORG.id,
      collectionId: fixture.collection.id,
      sourceId: fixture.source.id,
      documentPath: fixture.document.path,
      attempts: 3,
      error: "upstream is down",
    });

    const record = await db.getMemoryExtraction(
      fixture.source.id,
      fixture.document.path
    );
    expect(record).toMatchObject({ status: "failed", attempts: 3 });
    expect(record?.lastError).toBe("upstream is down");

    const alerts = await extractionAlerts(db, fixture.source.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.type).toBe("ingestion");
    expect(alerts[0]!.detail).toContain("1 Document");
  });

  it("clears the Alert once the Source's Documents are extracted again", async () => {
    const db = getMockDb();
    const fixture = await seedDocument(db);
    await recordFailedExtraction({
      db,
      organizationId: DEMO_ORG.id,
      collectionId: fixture.collection.id,
      sourceId: fixture.source.id,
      documentPath: fixture.document.path,
      attempts: 3,
      error: "upstream is down",
    });
    expect(await extractionAlerts(db, fixture.source.id)).toHaveLength(1);

    mocks.generateObject.mockResolvedValue({
      object: { memories: [] },
      usage: undefined,
    });
    expect(await run(fixture, db)).toBe("extracted");
    expect(
      (await db.getMemoryExtraction(fixture.source.id, fixture.document.path))
        ?.status
    ).toBe("done");
    const { signalExtractionHealth } = await import("./extract-document-memories");
    await signalExtractionHealth(db, DEMO_ORG.id, fixture.source.id);

    expect(await extractionAlerts(db, fixture.source.id)).toEqual([]);
  });
});
