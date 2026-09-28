import { describe, expect, it, vi } from "vitest";
import type { Db } from "@agent-hub/db";
import type { KnowledgeSearchResult } from "@agent-hub/core";
import { searchKnowledge } from "./knowledge-search";

/**
 * The turn-less search behind `knowledge.search`. What it decides is the
 * scope, so that is what these assert: an Assistant searches only what is
 * linked to it, no Assistant searches every Collection the Organization owns,
 * and an Organization with nothing to search costs no query at all.
 *
 * `connections: []` means no embedding model, so both adapters take their
 * lexical path: the real no-provider behaviour, not a stub of it.
 */

const hit = (conceptId: string): KnowledgeSearchResult => ({
  conceptId,
  conceptTitle: conceptId,
  conceptPath: `${conceptId}.md`,
  collectionId: "col-1",
  collectionName: "Library",
  sourceName: "Article",
  sourceId: "src-1",
  resourceUrl: null,
  content: `About ${conceptId}`,
  similarity: 0.5,
});

function stubDb(collectionIds: string[]) {
  const searchChunks = vi.fn(async () => [hit("assistant-scoped")]);
  const searchCollectionChunks = vi.fn(async () => [hit("library-wide")]);
  const listOrgCollections = vi.fn(async () =>
    collectionIds.map((id) => ({ id, name: id }))
  );
  const db = {
    searchChunks,
    searchCollectionChunks,
    searchSourceChunks: vi.fn(async () => []),
    listOrgCollections,
  } as unknown as Db;
  return { db, searchChunks, searchCollectionChunks, listOrgCollections };
}

describe("searchKnowledge", () => {
  it("searches only an Assistant's linked Sources when given one", async () => {
    const { db, searchChunks, listOrgCollections } = stubDb(["col-1"]);
    const results = await searchKnowledge({
      db,
      connections: [],
      organizationId: "org-1",
      query: "reset password",
      assistantId: "as-1",
    });
    expect(results.map((result) => result.conceptId)).toEqual(["assistant-scoped"]);
    // Assistant-wide: no anchored Collection, the link set is the scope.
    expect(searchChunks).toHaveBeenCalledWith(
      "as-1",
      null,
      expect.objectContaining({ text: "reset password" })
    );
    expect(listOrgCollections).not.toHaveBeenCalled();
  });

  it("searches every Collection of the Organization without an Assistant", async () => {
    const { db, searchChunks, searchCollectionChunks } = stubDb(["col-1", "col-2"]);
    const results = await searchKnowledge({
      db,
      connections: [],
      organizationId: "org-1",
      query: "vpn",
      assistantId: null,
    });
    expect(results.map((result) => result.conceptId)).toEqual(["library-wide"]);
    expect(searchCollectionChunks).toHaveBeenCalledWith(
      "org-1",
      ["col-1", "col-2"],
      expect.objectContaining({ text: "vpn" })
    );
    expect(searchChunks).not.toHaveBeenCalled();
  });

  it("answers an empty Library with no results and no query", async () => {
    const { db, searchCollectionChunks } = stubDb([]);
    const results = await searchKnowledge({
      db,
      connections: [],
      organizationId: "org-1",
      query: "anything",
      assistantId: null,
    });
    expect(results).toEqual([]);
    expect(searchCollectionChunks).not.toHaveBeenCalled();
  });
});
