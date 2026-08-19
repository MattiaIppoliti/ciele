import { describe, expect, it } from "vitest";
import { getMockDb, DEMO_ORG } from "@agent-hub/db";
import { chunkMarkdown, persistConcept } from "./ingest";

/**
 * The ingestion write path. chunkMarkdown is the pure chunker every route
 * shares; persistConcept is the single Concept write seam (create + index).
 * With no Provider Connections, embeddings are null and retrieval falls
 * back to lexical, so these tests run offline.
 */

describe("chunkMarkdown", () => {
  it("keeps a short body as one chunk", () => {
    expect(chunkMarkdown("One paragraph.")).toEqual(["One paragraph."]);
  });

  it("splits on paragraph boundaries around ~1200 chars", () => {
    const paragraph = "x".repeat(700);
    const chunks = chunkMarkdown([paragraph, paragraph, paragraph].join("\n\n"));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // Chunks never split a paragraph in half.
      expect(chunk.length % 700 === 0 || chunk.includes("\n\n")).toBe(true);
    }
    expect(chunks.join("")).toContain("x".repeat(700));
  });

  it("drops empty output for an empty body", () => {
    expect(chunkMarkdown("")).toEqual([]);
    expect(chunkMarkdown("\n\n\n")).toEqual([]);
  });
});

describe("persistConcept", () => {
  const db = getMockDb();

  it("creates the Concept and indexes it for retrieval, title-prefixed", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, {
      title: "Ingest Test Assistant",
    });
    const collection = await db.createCollection(assistant.id, {
      name: "Ingest Collection",
    });
    // Retrieval is link-based (PRD #726/#733): a Concept answers through its
    // Source, and `createSource` does not link; Collections are org-owned, so
    // the link is what puts the Source in this assistant's corpus.
    const source = await db.createSource({
      collectionId: collection.id,
      name: "Enrollment policy",
      kind: "text",
    });
    await db.setSourceAssistantLinks(source.id, [assistant.id]);

    const concept = await persistConcept({
      db,
      assistantId: assistant.id,
      collectionId: collection.id,
      sourceId: source.id,
      path: "policies/enrollment.md",
      frontmatter: { type: "Policy", title: "Enrollment policy" },
      body: "Enrollment closes at the end of September.",
      connections: [],
    });

    expect(concept.path).toBe("policies/enrollment.md");
    const results = await db.searchChunks(assistant.id, collection.id, {
      embedding: null,
      text: "enrollment september",
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].conceptId).toBe(concept.id);
    expect(results[0].conceptTitle).toBe("Enrollment policy");
    // The retrieval title prefixes the chunk content.
    expect(results[0].content.startsWith("Enrollment policy")).toBe(true);
  });

  it("falls back to the path as retrieval title when frontmatter has none", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, {
      title: "Ingest Test Assistant 2",
    });
    const collection = await db.createCollection(assistant.id, {
      name: "Ingest Collection 2",
    });
    const source = await db.createSource({
      collectionId: collection.id,
      name: "untitled-note.md",
      kind: "text",
    });
    await db.setSourceAssistantLinks(source.id, [assistant.id]);
    await persistConcept({
      db,
      assistantId: assistant.id,
      collectionId: collection.id,
      sourceId: source.id,
      path: "untitled-note.md",
      frontmatter: { type: "Note" },
      body: "Cafeteria opens at noon.",
      connections: [],
    });
    const results = await db.searchChunks(assistant.id, collection.id, {
      embedding: null,
      text: "cafeteria noon",
    });
    expect(results[0].content.startsWith("untitled-note.md")).toBe(true);
  });
});
