import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@agent-hub/db";
import type { KnowledgeSearchResult } from "@agent-hub/core";
import { KNOWLEDGE_SEARCH_LIMIT, buildCollectionSearcher, buildKnowledgeSearcher } from "./retrieval";

/**
 * The Teammate searcher's union (#767 follow-up).
 *
 * A Knowledge Scope has two halves, whole Collections and individual Library
 * items, and this is the one place they become a single search. What is worth
 * asserting is not that each half is queried, it is the three things the merge
 * decides: that a half with nothing in it costs no query, that the same passage
 * reached both ways spends one result slot rather than two, and that the merged
 * list is still ranked and still capped at the one top-k. Get any of those wrong
 * and a two-part scope quietly answers worse than a one-part scope.
 *
 * `connections: []` means there is no embedding model, so the embedder returns
 * null and both adapters take their lexical path. That is the real no-provider
 * behaviour, not a stub of it.
 */

const hit = (
  conceptId: string,
  content: string,
  similarity: number
): KnowledgeSearchResult => ({
  conceptId,
  conceptTitle: conceptId,
  conceptPath: `${conceptId}.md`,
  collectionId: "col-1",
  collectionName: "Handbook",
  sourceName: "Handbook.pdf",
  sourceId: "src-1",
  directAccess: false,
  resourceUrl: null,
  content,
  similarity,
});

function stubDb(over: Partial<Db> = {}): {
  db: Db;
  byCollection: ReturnType<typeof vi.fn>;
  bySource: ReturnType<typeof vi.fn>;
} {
  const byCollection = vi.fn(async () => [] as KnowledgeSearchResult[]);
  const bySource = vi.fn(async () => [] as KnowledgeSearchResult[]);
  return {
    db: {
      searchCollectionChunks: byCollection,
      searchSourceChunks: bySource,
      ...over,
    } as unknown as Db,
    byCollection,
    bySource,
  };
}

const searcher = (
  db: Db,
  collectionIds: string[],
  sourceIds: string[]
) =>
  buildCollectionSearcher({
    db,
    connections: [],
    organizationId: "org-1",
    collectionIds,
    sourceIds,
    conversationId: null,
  });

describe("buildCollectionSearcher", () => {
  it("asks neither adapter for a half that is empty", async () => {
    const { db, byCollection, bySource } = stubDb();
    expect(await searcher(db, [], [])("anything")).toEqual([]);
    expect(byCollection).not.toHaveBeenCalled();
    expect(bySource).not.toHaveBeenCalled();
  });

  it("searches only Collections when the scope names no Library items", async () => {
    const only = [hit("c-1", "Refunds take five days.", 0.9)];
    const { db, bySource } = stubDb({
      searchCollectionChunks: vi.fn(async () => only),
    } as Partial<Db>);
    expect(await searcher(db, ["col-1"], [])("refunds")).toEqual(only);
    expect(bySource).not.toHaveBeenCalled();
  });

  it("searches only Library items when the scope names no Collections", async () => {
    const only = [hit("s-1", "Refunds take five days.", 0.9)];
    const { db } = stubDb({
      searchSourceChunks: vi.fn(async () => only),
    } as Partial<Db>);
    expect(await searcher(db, [], ["src-1"])("refunds")).toEqual(only);
  });

  it("spends one slot on a passage both halves return", async () => {
    // The overlap case a Member creates by ticking a file that sits inside a
    // Collection they already scoped. Without the dedup, half the top-k is the
    // same paragraph twice.
    const shared = hit("c-1", "Refunds take five days.", 0.9);
    const { db } = stubDb({
      searchCollectionChunks: vi.fn(async () => [shared]),
      searchSourceChunks: vi.fn(async () => [{ ...shared, similarity: 0.7 }]),
    } as Partial<Db>);

    const results = await searcher(db, ["col-1"], ["src-1"])("refunds");
    expect(results).toHaveLength(1);
    // The better-scoring copy wins, so a dedup never lowers a hit's rank.
    expect(results[0].similarity).toBe(0.9);
  });

  it("re-ranks across the two halves and keeps the one top-k", async () => {
    const { db } = stubDb({
      searchCollectionChunks: vi.fn(async () =>
        Array.from({ length: KNOWLEDGE_SEARCH_LIMIT }, (_, i) =>
          hit(`c-${i}`, `collection ${i}`, 0.5 - i * 0.01)
        )
      ),
      searchSourceChunks: vi.fn(async () => [
        hit("s-1", "source best", 0.99),
        hit("s-2", "source second", 0.98),
      ]),
    } as Partial<Db>);

    const results = await searcher(db, ["col-1"], ["src-1"])("refunds");
    expect(results).toHaveLength(KNOWLEDGE_SEARCH_LIMIT);
    // A strong Library-item hit outranks every Collection hit, which is the
    // whole point of picking the item: it must not be crowded out by the bundle.
    expect(results.slice(0, 2).map((r) => r.conceptId)).toEqual(["s-1", "s-2"]);
    expect(
      results.every(
        (result, i) => i === 0 || results[i - 1].similarity >= result.similarity
      )
    ).toBe(true);
  });
});

describe("Study Mode during ingestion", () => {
  afterEach(() => vi.useRealTimers());

  function fixture(collectionId: string | null = null) {
    let ready = false;
    const searchChunks = vi.fn(async () => ready ? [hit("iso", "ISO 27001", 1)] : []);
    const getSource = vi.fn(async () => ({ id: "src-1", collectionId: "col-1", status: ready ? "ready" : "processing" }));
    const listAssistantSourceIds = vi.fn(async () => ["src-1"]);
    const search = buildKnowledgeSearcher({
      db: { searchChunks, getSource, listAssistantSourceIds } as unknown as Db,
      connections: [], assistant: { id: "assistant-1", organizationId: "org-1", knowledgeEngine: "vector" },
      collectionId, conversationId: null, waitForIndexing: true,
    });
    return { search, searchChunks, getSource, listAssistantSourceIds, finish: () => { ready = true; } };
  }

  it("retries after the uploaded material is committed, sharing the wait across batched queries", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const result = Promise.all([f.search("ISO"), f.search("ISO 27001")]);
    await vi.advanceTimersByTimeAsync(2_000);
    f.finish();
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await result).map((hits) => hits[0]?.conceptId)).toEqual(["iso", "iso"]);
    expect(f.listAssistantSourceIds).toHaveBeenCalledTimes(1);
    expect(f.searchChunks).toHaveBeenCalledTimes(4);
  });

  it("reports processing instead of missing knowledge after a bounded wait, without waiting again", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const result = expect(f.search("ISO")).rejects.toThrow("still being processed");
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    await expect(f.search("ISO standard")).rejects.toThrow("still being processed");
    expect(f.listAssistantSourceIds).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not delay an answer when committed material already matches", async () => {
    const f = fixture();
    f.finish();
    expect(await f.search("ISO")).toHaveLength(1);
    expect(f.getSource).not.toHaveBeenCalled();
  });

  it("ignores processing Sources outside the anchored Collection but checks them when widening", async () => {
    vi.useFakeTimers();
    const f = fixture("other-collection");
    expect(await f.search("ISO")).toEqual([]);
    const result = f.search("ISO", { scope: "assistant" });
    await vi.advanceTimersByTimeAsync(1_000);
    f.finish();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toHaveLength(1);
  });

  it("preserves a genuine no-match without polling", async () => {
    const f = fixture();
    f.getSource.mockResolvedValue({ id: "src-1", collectionId: "col-1", status: "ready" });
    expect(await f.search("unrelated")).toEqual([]);
    expect(f.searchChunks).toHaveBeenCalledTimes(1);
  });
});
