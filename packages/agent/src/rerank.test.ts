import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockRerankingModelV4 } from "ai/test";
import type { AiUsageInput, KnowledgeSearchResult, ProviderConnection } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import {
  RERANK_CANDIDATES,
  RERANK_FAILURES_BEFORE_ALERT,
  RERANK_MODEL,
  createReranker,
  estimateRerankTokens,
  platformRerankingModel,
  resetRerankHealthForTests,
} from "./rerank";
import { KNOWLEDGE_SEARCH_LIMIT, buildKnowledgeSearcher } from "./retrieval";

/**
 * The rerank stage (ADR-0025). What matters is the contract the rest of the
 * runtime relies on: the reranker only reorders and truncates the index's own
 * results, it fails open to exactly today's order, it meters one `rerank` row
 * on the caller's spenders, and it never reaches for a Provider Connection.
 */

const hit = (i: number): KnowledgeSearchResult => ({
  conceptId: `c-${i}`,
  conceptTitle: `Concept ${i}`,
  conceptPath: `c-${i}.md`,
  collectionId: "col-1",
  collectionName: "Readings",
  sourceName: "Reading.pdf",
  sourceId: `src-${i % 7}`,
  directAccess: false,
  resourceUrl: null,
  content: `passage ${i}`,
  similarity: 1 - i / 100,
});

const candidates = Array.from({ length: RERANK_CANDIDATES }, (_, i) => hit(i));

function stubDb() {
  const recordAiUsage = vi.fn(async (_rows: AiUsageInput[]) => {});
  const raiseAlert = vi.fn(async () => {});
  const resolveAlertsByKey = vi.fn(async () => {});
  const db = { recordAiUsage, raiseAlert, resolveAlertsByKey } as unknown as Db;
  return { db, recordAiUsage, raiseAlert, resolveAlertsByKey };
}

const attribution = (db: Db) => ({
  db,
  organizationId: "org-1",
  assistantId: "assistant-1",
  conversationId: "conv-1",
  spenders: { memberId: "member-1" },
  surface: "widget" as const,
});

/** A model that ranks the candidates in reverse, the clearest possible reorder. */
function reversingModel() {
  return new MockRerankingModelV4({
    doRerank: async ({ documents, topN }) => ({
      ranking: documents.values
        .map((_, index) => ({ index, relevanceScore: index / documents.values.length }))
        .reverse()
        .slice(0, topN ?? documents.values.length),
    }),
  });
}

beforeEach(() => resetRerankHealthForTests());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("createReranker", () => {
  it("reorders the candidates and keeps the top six", async () => {
    const { db } = stubDb();
    const rerank = createReranker({ attribution: attribution(db), resolveModel: reversingModel });

    const results = await rerank("query", candidates, KNOWLEDGE_SEARCH_LIMIT);

    expect(results.map((r) => r.conceptId)).toEqual([
      "c-19", "c-18", "c-17", "c-16", "c-15", "c-14",
    ]);
    // The same objects the index returned: citations see today's shape.
    expect(results[0]).toBe(candidates[19]);
  });

  it("sends the passages and the query, and asks for the top six", async () => {
    const { db } = stubDb();
    const doRerank = vi.fn(async () => ({ ranking: [{ index: 3, relevanceScore: 0.9 }] }));
    const rerank = createReranker({
      attribution: attribution(db),
      resolveModel: () => new MockRerankingModelV4({ doRerank }),
    });

    await rerank("when is tuition due?", candidates, KNOWLEDGE_SEARCH_LIMIT);

    expect(doRerank).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "when is tuition due?",
        topN: KNOWLEDGE_SEARCH_LIMIT,
        documents: { type: "text", values: candidates.map((c) => c.content) },
      })
    );
  });

  it("meters one rerank row on the caller's spenders at the platform key", async () => {
    const { db, recordAiUsage } = stubDb();
    const rerank = createReranker({ attribution: attribution(db), resolveModel: reversingModel });

    await rerank("query", candidates, KNOWLEDGE_SEARCH_LIMIT);

    expect(recordAiUsage).toHaveBeenCalledTimes(1);
    const [rows] = recordAiUsage.mock.calls[0];
    expect(rows).toEqual([
      expect.objectContaining({
        organizationId: "org-1",
        assistantId: "assistant-1",
        conversationId: "conv-1",
        stage: "rerank",
        provider: "voyage",
        modelId: RERANK_MODEL,
        credentialKind: "platform",
        inputTokens: estimateRerankTokens("query", candidates.map((c) => c.content)),
        outputTokens: 0,
        spenders: { memberId: "member-1" },
        surface: "widget",
      }),
    ]);
  });

  it("prefers a billed token count when the provider reports one", async () => {
    const { db, recordAiUsage } = stubDb();
    const rerank = createReranker({
      attribution: attribution(db),
      resolveModel: () =>
        new MockRerankingModelV4({
          doRerank: async () => ({
            ranking: [{ index: 0, relevanceScore: 1 }],
            providerMetadata: { gateway: { usage: { totalTokens: 4321 } } },
          }),
        }),
    });

    await rerank("query", candidates, KNOWLEDGE_SEARCH_LIMIT);

    expect(recordAiUsage.mock.calls[0][0][0].inputTokens).toBe(4321);
  });

  it("keeps the hybrid order when there is no Gateway key", async () => {
    const { db, recordAiUsage, raiseAlert } = stubDb();
    const rerank = createReranker({ attribution: attribution(db), resolveModel: () => null });

    const results = await rerank("query", candidates, KNOWLEDGE_SEARCH_LIMIT);

    expect(results).toEqual(candidates.slice(0, KNOWLEDGE_SEARCH_LIMIT));
    expect(recordAiUsage).not.toHaveBeenCalled();
    // A self-host without a key is a configuration, not an outage.
    expect(raiseAlert).not.toHaveBeenCalled();
  });

  it("keeps the hybrid order when the provider errors", async () => {
    const { db, recordAiUsage } = stubDb();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const rerank = createReranker({
      attribution: attribution(db),
      resolveModel: () =>
        new MockRerankingModelV4({
          doRerank: async () => {
            throw new Error("503 from provider");
          },
        }),
    });

    const results = await rerank("query", candidates, KNOWLEDGE_SEARCH_LIMIT);

    expect(results).toEqual(candidates.slice(0, KNOWLEDGE_SEARCH_LIMIT));
    expect(recordAiUsage).not.toHaveBeenCalled();
  });

  it("keeps the hybrid order when the call outlives its timeout", async () => {
    const { db } = stubDb();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const rerank = createReranker({
      attribution: attribution(db),
      timeoutMs: 20,
      resolveModel: () =>
        new MockRerankingModelV4({
          doRerank: ({ abortSignal }) =>
            new Promise((_, reject) => {
              abortSignal?.addEventListener("abort", () => reject(abortSignal.reason));
            }),
        }),
    });

    const results = await rerank("query", candidates, KNOWLEDGE_SEARCH_LIMIT);

    expect(results).toEqual(candidates.slice(0, KNOWLEDGE_SEARCH_LIMIT));
  });

  it("raises a system Alert only after repeated failures, and clears it on recovery", async () => {
    const { db, raiseAlert, resolveAlertsByKey } = stubDb();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let failing = true;
    const rerank = createReranker({
      attribution: attribution(db),
      resolveModel: () =>
        new MockRerankingModelV4({
          doRerank: async () => {
            if (failing) throw new Error("down");
            return { ranking: [{ index: 0, relevanceScore: 1 }] };
          },
        }),
    });

    for (let i = 1; i < RERANK_FAILURES_BEFORE_ALERT; i += 1) {
      await rerank("query", candidates, KNOWLEDGE_SEARCH_LIMIT);
    }
    expect(raiseAlert).not.toHaveBeenCalled();
    await rerank("query", candidates, KNOWLEDGE_SEARCH_LIMIT);
    expect(raiseAlert).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ type: "system", sourceKey: "rerank:org-1" })
    );

    failing = false;
    await rerank("query", candidates, KNOWLEDGE_SEARCH_LIMIT);
    expect(resolveAlertsByKey).toHaveBeenCalledWith("org-1", "rerank:org-1");
  });

  it("skips the call when there is nothing to choose between", async () => {
    const { db } = stubDb();
    const doRerank = vi.fn();
    const rerank = createReranker({
      attribution: attribution(db),
      resolveModel: () => new MockRerankingModelV4({ doRerank }),
    });

    expect(await rerank("query", [candidates[0]], KNOWLEDGE_SEARCH_LIMIT)).toEqual([candidates[0]]);
    expect(doRerank).not.toHaveBeenCalled();
  });
});

describe("platformRerankingModel", () => {
  it("is the Gateway reranker when the platform key is set", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "platform-key");
    expect(platformRerankingModel()).toMatchObject({ modelId: RERANK_MODEL });
  });

  it("is null without the platform key, whatever the Organization has connected", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    // It takes no connections at all: a personal subscription cannot fund it.
    expect(platformRerankingModel.length).toBe(0);
    expect(platformRerankingModel()).toBeNull();
  });
});

describe("buildKnowledgeSearcher with the rerank stage", () => {
  it("asks the index for twenty candidates and returns the reranker's six", async () => {
    const searchChunks = vi.fn(async () => candidates);
    const reranker = vi.fn(async (_q: string, hits: KnowledgeSearchResult[], limit: number) =>
      [...hits].reverse().slice(0, limit)
    );
    const personal: ProviderConnection = {
      id: "conn-personal",
      organizationId: "org-1",
      provider: "anthropic",
      type: "subscription",
    } as ProviderConnection;
    const search = buildKnowledgeSearcher({
      db: { searchChunks } as unknown as Db,
      connections: [personal],
      assistant: { id: "assistant-1", organizationId: "org-1" },
      collectionId: "col-1",
      conversationId: "conv-1",
      reranker,
    });

    const results = await search("tuition");

    expect(searchChunks).toHaveBeenCalledWith(
      "assistant-1",
      "col-1",
      expect.objectContaining({ text: "tuition", limit: RERANK_CANDIDATES })
    );
    expect(reranker).toHaveBeenCalledWith("tuition", candidates, KNOWLEDGE_SEARCH_LIMIT);
    expect(results.map((r) => r.conceptId)).toEqual([
      "c-19", "c-18", "c-17", "c-16", "c-15", "c-14",
    ]);
  });
});
