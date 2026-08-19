import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Concept, KnowledgeSearchResult } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import {
  hydrateGraphProvenance,
  INTERACTIVE_GRAPH_SEARCH_TIMEOUT_MS,
  withGraphEngine,
} from "./graph-search";
import * as graphWorker from "./graph-worker";
import type { KnowledgeSearcher } from "./types";

// The graph engine's retrieval seam, off-network: the graph-worker client is
// faked so we exercise success (graph result hydrated to citations), the
// same-turn vector fallback (error / empty / assistant-wide / unconfigured),
// and the QA-id trace callback.
vi.mock("./graph-worker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./graph-worker")>();
  return {
    ...actual,
    isGraphWorkerConfigured: vi.fn(() => true),
    searchGraph: vi.fn(),
  };
});

const configured = vi.mocked(graphWorker.isGraphWorkerConfigured);
const searchGraph = vi.mocked(graphWorker.searchGraph);

function concept(overrides: Partial<Concept> = {}): Concept {
  return {
    id: "c1",
    collectionId: "col1",
    sourceId: "s1",
    path: "faq/reset.md",
    frontmatter: { type: "FAQ", title: "How do I reset?", resource: "https://x/reset" },
    body: "Open the portal.",
    excluded: false,
    ...overrides,
  } as Concept;
}

function fakeDb(overrides: Partial<Db> = {}): Db {
  return {
    getConcept: vi.fn().mockResolvedValue(concept()),
    getCollection: vi.fn().mockResolvedValue({ id: "col1", name: "Handbook" }),
    getSource: vi.fn().mockResolvedValue({
      id: "s1",
      name: "reset.pdf",
      kind: "file",
      originalObjectPath: "org/x/reset.pdf",
    }),
    listSourceAssistantLinks: vi
      .fn()
      .mockResolvedValue([
        { assistantId: "a1", assistantName: "Alex", directAccess: false },
      ]),
    recordAiUsage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Db;
}

const vectorResult: KnowledgeSearchResult = {
  conceptId: "v1",
  conceptTitle: "Vector hit",
  conceptPath: "v.md",
  collectionId: "col1",
  collectionName: "Handbook",
  sourceName: null,
  resourceUrl: null,
  content: "vector content",
  similarity: 0.9,
};

beforeEach(() => {
  vi.clearAllMocks();
  configured.mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe("hydrateGraphProvenance", () => {
  it("resolves each conceptId to a Concept → Source citation with the graph excerpt", async () => {
    const db = fakeDb();
    const results = await hydrateGraphProvenance(db, [
      { conceptId: "c1", sourceId: "s1", excerpt: "Open the portal." },
    ]);
    expect(results).toEqual([
      {
        conceptId: "c1",
        conceptTitle: "How do I reset?",
        conceptPath: "faq/reset.md",
        collectionId: "col1",
        collectionName: "Handbook",
        sourceName: "reset.pdf",
        resourceUrl: "https://x/reset",
        content: "Open the portal.",
        sourceId: "s1",
        directAccess: false,
        // Rank-descending: 1 - 0/(1+1) = 1 for the sole (first) entry.
        similarity: 1,
        // …which is exactly why the engine is stamped: that 1 is a placeholder,
        // not a relevance score, and the coverage gate must not read it as one.
        engine: "graph",
      },
    ]);
  });

  it("drops entries whose Concept is gone (graph lags a delete) and dedupes", async () => {
    const db = fakeDb({ getConcept: vi.fn().mockResolvedValue(null) });
    const results = await hydrateGraphProvenance(db, [
      { conceptId: "gone", sourceId: null, excerpt: "x" },
      { conceptId: "gone", sourceId: null, excerpt: "dup" },
    ]);
    expect(results).toEqual([]);
    // Deduped: only one lookup for the repeated conceptId.
    expect(db.getConcept).toHaveBeenCalledTimes(1);
  });

  it("drops hits whose Source is not linked to the querying assistant", async () => {
    // The graph indexes the whole Collection, which may hold Sources linked to
    // other Assistants: retrieval obeys the same link contract as vector.
    const db = fakeDb({
      listSourceAssistantLinks: vi
        .fn()
        .mockResolvedValue([
          { assistantId: "other", assistantName: "Other", directAccess: true },
        ]),
    });
    const results = await hydrateGraphProvenance(
      db,
      [{ conceptId: "c1", sourceId: "s1", excerpt: "Open the portal." }],
      "a1"
    );
    expect(results).toEqual([]);
  });

  it("stamps direct access from the querying assistant's own link", async () => {
    const db = fakeDb({
      listSourceAssistantLinks: vi.fn().mockResolvedValue([
        { assistantId: "a1", assistantName: "Alex", directAccess: true },
        { assistantId: "other", assistantName: "Other", directAccess: false },
      ]),
    });
    const results = await hydrateGraphProvenance(
      db,
      [{ conceptId: "c1", sourceId: "s1", excerpt: "Open the portal." }],
      "a1"
    );
    expect(results).toHaveLength(1);
    expect(results[0].sourceId).toBe("s1");
    expect(results[0].directAccess).toBe(true);
  });

  it("keeps direct access off when the original file is gone", async () => {
    const db = fakeDb({
      getSource: vi
        .fn()
        .mockResolvedValue({ id: "s1", name: "reset.pdf", kind: "file", originalObjectPath: null }),
      listSourceAssistantLinks: vi
        .fn()
        .mockResolvedValue([
          { assistantId: "a1", assistantName: "Alex", directAccess: true },
        ]),
    });
    const results = await hydrateGraphProvenance(
      db,
      [{ conceptId: "c1", sourceId: "s1", excerpt: "Open the portal." }],
      "a1"
    );
    expect(results[0].directAccess).toBe(false);
  });
});

describe("withGraphEngine", () => {
  const vector: KnowledgeSearcher = vi.fn().mockResolvedValue([vectorResult]);

  beforeEach(() => vi.mocked(vector).mockClear());

  function searcher(over: Partial<Parameters<typeof withGraphEngine>[0]> = {}) {
    return withGraphEngine({
      db: fakeDb(),
      collectionId: "col1",
      conversationId: "conv1",
      useGraph: true,
      vector,
      ...over,
    });
  }

  it("retrieves from the graph and reports the QA id when engine=graph", async () => {
    searchGraph.mockResolvedValue({
      answer: "",
      qaId: "qa-9",
      provenance: [{ conceptId: "c1", sourceId: "s1", excerpt: "Open the portal." }],
      usage: null,
    });
    const onTrace = vi.fn();
    const results = await searcher({ onTrace })("how do I reset?");
    expect(searchGraph).toHaveBeenCalledWith("col1", "how do I reset?", {
      mode: "chunks",
      sessionId: "conv1",
      timeoutMs: INTERACTIVE_GRAPH_SEARCH_TIMEOUT_MS,
    });
    expect(onTrace).toHaveBeenCalledWith("qa-9");
    expect(results[0].conceptId).toBe("c1");
    expect(vector).not.toHaveBeenCalled();
  });

  it("falls back to vector on a graph error", async () => {
    searchGraph.mockRejectedValue(new Error("worker down"));
    const results = await searcher()("q");
    expect(results).toEqual([vectorResult]);
    expect(vector).toHaveBeenCalledOnce();
  });

  it("falls back to vector when the graph returns nothing, and does NOT record a trace", async () => {
    // A qaId with empty provenance must not bind to the vector-served answer.
    searchGraph.mockResolvedValue({ answer: "", qaId: "qa-empty", provenance: [], usage: null });
    const onTrace = vi.fn();
    const results = await searcher({ onTrace })("q");
    expect(results).toEqual([vectorResult]);
    expect(onTrace).not.toHaveBeenCalled();
  });

  it("requests chunks mode with the interactive timeout, and never meters", async () => {
    // The only mode this path requests makes zero worker LLM calls, so there
    // is deliberately no graph_search meter here (re-enabling graph_completion
    // on the turn path must reintroduce one), and the interactive timeout caps
    // how long a turn can wait before the vector fallback.
    searchGraph.mockResolvedValue({ answer: "", qaId: null, provenance: [], usage: null });
    const db = fakeDb();
    await withGraphEngine({
      db,
      collectionId: "col1",
      conversationId: "conv1",
      useGraph: true,
      vector,
    })("q");
    expect(searchGraph).toHaveBeenCalledWith("col1", "q", {
      mode: "chunks",
      sessionId: "conv1",
      timeoutMs: INTERACTIVE_GRAPH_SEARCH_TIMEOUT_MS,
    });
    expect(db.recordAiUsage).not.toHaveBeenCalled();
  });

  it("uses vector for an assistant-wide widen (no single dataset to target)", async () => {
    const results = await searcher()("q", { scope: "assistant" });
    expect(searchGraph).not.toHaveBeenCalled();
    expect(results).toEqual([vectorResult]);
  });

  it("uses vector when engine=vector or the worker is unconfigured", async () => {
    await searcher({ useGraph: false })("q");
    expect(searchGraph).not.toHaveBeenCalled();

    configured.mockReturnValue(false);
    await searcher({ useGraph: true })("q");
    expect(searchGraph).not.toHaveBeenCalled();
    expect(vector).toHaveBeenCalledTimes(2);
  });

  it("uses vector when there is no anchored collection", async () => {
    const results = await searcher({ collectionId: null })("q");
    expect(searchGraph).not.toHaveBeenCalled();
    expect(results).toEqual([vectorResult]);
  });
});
