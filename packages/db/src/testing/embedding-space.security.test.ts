import { describe, expect, it } from "vitest";
import { createSupabaseContractContext } from "./supabase-contract-harness";

/**
 * #801, CYB-14: a cosine distance is only meaningful between vectors from the
 * same model. This runs against the real migrations in PGlite (real pgvector,
 * the real match RPCs), because the property under test lives in the SQL: the
 * matcher must refuse a cross-space comparison however well the foreign
 * vector scores, and must keep answering for legacy rows that predate the
 * column. The mock is lexical-only, so this cannot be a shared-contract case.
 */

const axis = (i: number): number[] => {
  const v = new Array(1536).fill(0);
  v[i] = 1;
  return v;
};

describe("embedding-space isolation on the vector path", () => {
  it("matches within the query's space, tolerates legacy null, excludes the rest", async () => {
    const ctx = await createSupabaseContractContext();
    const db = ctx.db;
    const assistant = await db.createAssistant(ctx.organizationId, {
      title: "Space Fixture",
    });
    const collection = await db.createCollection(assistant.id, { name: "K" });
    const source = await db.createSource({
      collectionId: collection.id,
      name: "space.md",
      kind: "file",
    });
    const concept = await db.createConcept({
      collectionId: collection.id,
      sourceId: source.id,
      path: "space.md",
      frontmatter: { type: "Note", title: "Space" },
      body: "content",
    });
    await db.setSourceAssistantLinks(source.id, [assistant.id]);

    // Three chunks on the same axis as the query, so absent the space filter
    // every one of them is a perfect cosine match. Only the space separates
    // them: current, legacy (null), and a different model's geometry.
    await db.saveChunks([
      {
        conceptId: concept.id,
        collectionId: collection.id,
        sourceId: source.id,
        content: "current space",
        embedding: axis(0),
        embeddingSpace: "openai:text-embedding-3-small",
      },
      {
        conceptId: concept.id,
        collectionId: collection.id,
        sourceId: source.id,
        content: "legacy row",
        embedding: axis(0),
        embeddingSpace: null,
      },
      {
        conceptId: concept.id,
        collectionId: collection.id,
        sourceId: source.id,
        content: "foreign space",
        embedding: axis(0),
        embeddingSpace: "google:text-embedding-004",
      },
    ]);

    const query = {
      // "xyzzy" matches nothing lexically, so every hit below came off the
      // vector path and the assertion is about the matcher, not the top-up.
      text: "xyzzy",
      embedding: axis(0),
      limit: 6,
      embeddingSpace: "openai:text-embedding-3-small",
    };
    const hits = await db.searchChunks(assistant.id, collection.id, query);
    const contents = hits.map((hit) => hit.content);

    expect(contents).toContain("current space");
    // Null is "embedded before the column existed", assumed current until
    // re-embedded: excluding it would blank existing corpora overnight.
    expect(contents).toContain("legacy row");
    // The point of the column: a perfect score in the wrong geometry is not
    // an answer.
    expect(contents).not.toContain("foreign space");

    // A caller that names no space (legacy caller) keeps pre-column behavior.
    const unscoped = await db.searchChunks(assistant.id, collection.id, {
      ...query,
      embeddingSpace: null,
    });
    expect(unscoped.map((hit) => hit.content)).toContain("foreign space");
    // The generous budget is for the context, not the assertions: loading the
    // full migration chain into a fresh PGlite exceeds the 15s default when
    // the suite's other PGlite files run beside it. Same figure the other
    // harness users give their beforeAll.
  }, 120_000);
});
