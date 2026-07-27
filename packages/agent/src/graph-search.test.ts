import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Concept, KnowledgeSearchResult } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { hydrateGraphProvenance, withGraphEngine } from "./graph-search";
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
    getSource: vi.fn().mockResolvedValue({ id: "s1", name: "reset.pdf" }),
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
});

describe("withGraphEngine", () => {
  const vector: KnowledgeSearcher = vi.fn().mockResolvedValue([vectorResult]);

  beforeEach(() => vi.mocked(vector).mockClear());

  function searcher(over: Partial<Parameters<typeof withGraphEngine>[0]> = {}) {
    return withGraphEngine({
      db: fakeDb(),
      organizationId: "org1",
      assistantId: "a1",
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

  it("meters reported LLM usage into the ledger, even when falling back to vector", async () => {
    // Tokens were spent on the worker regardless of whether the graph result
    // ends up serving the answer — empty provenance still meters.
    searchGraph.mockResolvedValue({
      answer: "",
      qaId: null,
      provenance: [],
      usage: { inputTokens: 7500, outputTokens: 150, llmCalls: 3, modelId: "gemini/gemini-2.0-flash", provider: "gemini" },
    });
    const db = fakeDb();
    const results = await withGraphEngine({
      db,
      organizationId: "org1",
      assistantId: "a1",
      collectionId: "col1",
      conversationId: "conv1",
      useGraph: true,
      vector,
    })("q");
    expect(results).toEqual([vectorResult]);
    expect(db.recordAiUsage).toHaveBeenCalledWith([
      {
        organizationId: "org1",
        assistantId: "a1",
        conversationId: "conv1",
        stage: "graph_search",
        provider: "google",
        modelId: "gemini/gemini-2.0-flash",
        credentialKind: "platform",
        inputTokens: 7500,
        outputTokens: 150,
      },
    ]);
  });

  it("does not write the ledger when the worker reports no usage", async () => {
    searchGraph.mockResolvedValue({ answer: "", qaId: null, provenance: [], usage: null });
    const db = fakeDb();
    await withGraphEngine({
      db,
      organizationId: "org1",
      assistantId: "a1",
      collectionId: "col1",
      conversationId: "conv1",
      useGraph: true,
      vector,
    })("q");
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
