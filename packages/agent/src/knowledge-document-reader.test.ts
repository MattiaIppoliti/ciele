import { describe, expect, it, vi } from "vitest";
import type { Db } from "@agent-hub/db";
import { createDocumentReaderFactory } from "./knowledge-document-reader";

/**
 * The tenancy check a model-supplied Concept id passes through. Previously
 * reachable only by driving a whole Conversation Turn, which is why the
 * cross-tenant case below had never been asserted on its own.
 */

const concept = (over: Record<string, unknown> = {}) => ({
  id: "concept-1",
  collectionId: "col-mine",
  sourceId: "source-1",
  path: "refunds.md",
  frontmatter: { title: "Refund policy" },
  body: "You may return an item within 30 days.",
  ...over,
});

function makeDb(overrides: Partial<Record<keyof Db, unknown>> = {}) {
  return {
    listCollections: vi.fn(async () => [{ id: "col-mine" }]),
    getConcept: vi.fn(async () => concept()),
    getSource: vi.fn(async () => ({ name: "Returns handbook" })),
    ...overrides,
  } as unknown as Db;
}

describe("createDocumentReaderFactory", () => {
  it("reads a Concept the Assistant's own Collection holds, and names its Source", async () => {
    const db = makeDb();
    const read = createDocumentReaderFactory(db)("assistant-1");
    expect(await read("concept-1")).toEqual({
      id: "concept-1",
      title: "Refund policy",
      sourceName: "Returns handbook",
      text: "You may return an item within 30 days.",
    });
    expect(vi.mocked(db.listCollections)).toHaveBeenCalledWith("assistant-1");
  });

  it("refuses a Concept outside the Assistant's Collections", async () => {
    const db = makeDb({
      getConcept: vi.fn(async () => concept({ collectionId: "col-other-tenant" })),
    });
    const read = createDocumentReaderFactory(db)("assistant-1");
    expect(await read("concept-1")).toBeNull();
  });

  it("refuses an id that resolves to nothing", async () => {
    const db = makeDb({ getConcept: vi.fn(async () => null) });
    expect(await createDocumentReaderFactory(db)("a1")("ghost")).toBeNull();
  });

  it("reads nothing at all for a blank id", async () => {
    const db = makeDb();
    expect(await createDocumentReaderFactory(db)("a1")("   ")).toBeNull();
    expect(vi.mocked(db.listCollections)).not.toHaveBeenCalled();
    expect(vi.mocked(db.getConcept)).not.toHaveBeenCalled();
  });

  it("trims the id the model supplied", async () => {
    const db = makeDb();
    expect(await createDocumentReaderFactory(db)("a1")(" concept-1 ")).toMatchObject({
      id: "concept-1",
    });
    expect(vi.mocked(db.getConcept)).toHaveBeenCalledWith("concept-1");
  });

  it("loads the Collection list once per reader, however many reads", async () => {
    const db = makeDb();
    const read = createDocumentReaderFactory(db)("assistant-1");
    await read("concept-1");
    await read("concept-1");
    await read("concept-1");
    expect(vi.mocked(db.listCollections)).toHaveBeenCalledTimes(1);
  });

  it("gives each Assistant its own cache, so one never answers for another", async () => {
    const db = makeDb();
    const factory = createDocumentReaderFactory(db);
    await factory("assistant-1")("concept-1");
    await factory("assistant-2")("concept-1");
    expect(vi.mocked(db.listCollections).mock.calls).toEqual([
      ["assistant-1"],
      ["assistant-2"],
    ]);
  });

  it("falls back to the Concept path when the frontmatter has no title", async () => {
    const db = makeDb({
      getConcept: vi.fn(async () => concept({ frontmatter: { title: "" } })),
    });
    expect(await createDocumentReaderFactory(db)("a1")("concept-1")).toMatchObject({
      title: "refunds.md",
    });
  });

  it("still reads when the Source lookup fails or there is no Source", async () => {
    const failing = makeDb({
      getSource: vi.fn(async () => {
        throw new Error("source table down");
      }),
    });
    expect(
      await createDocumentReaderFactory(failing)("a1")("concept-1")
    ).toMatchObject({ sourceName: null });

    const orphan = makeDb({
      getConcept: vi.fn(async () => concept({ sourceId: null })),
    });
    expect(
      await createDocumentReaderFactory(orphan)("a1")("concept-1")
    ).toMatchObject({ sourceName: null });
    expect(vi.mocked(orphan.getSource)).not.toHaveBeenCalled();
  });
});
