/**
 * The ONE way a `KnowledgeSearcher` is built (#c2 of the 2026-08 architecture
 * review). Before this factory existed, the `embedText → db.searchChunks`
 * closure was hand-written at four call sites, the live turn, the handover
 * continuation, the standing-goal evals and the Suggested Fix job, and they had
 * drifted, so the loop meant to catch retrieval regressions exercised a
 * retrieval path production never used.
 *
 * The factory owns, in one place:
 *  - the scope-tier widen (#155): an "assistant" pass drops the anchored
 *    Collection filter; `searchChunks` treats a null collection as
 *    assistant-wide,
 *  - one lazily-resolved embedding client per searcher (credential decrypt and
 *    provider construction happen once per turn, not once per query),
 *  - the rerank stage (ADR-0025): the index returns `RERANK_CANDIDATES`
 *    passages and the reranker picks `KNOWLEDGE_SEARCH_LIMIT`, for EVERY
 *    caller, so synthetic traffic tests the path a widget Visitor gets.
 *
 * Internal module: the barrels do not export it. Callers outside the runtime
 * hand `streamConversationTurn` config, never searchers.
 */

import type {
  Assistant,
  ProviderConnection,
  UsageSpenders,
  UsageSurface,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { createEmbedder, embeddingSpaceId } from "./embeddings";
import { createReranker, RERANK_CANDIDATES, type Reranker } from "./rerank";
import type { KnowledgeSearcher } from "./types";

/** How many chunks one search pass returns, the one top-k for knowledge. */
export const KNOWLEDGE_SEARCH_LIMIT = 6;

export function buildKnowledgeSearcher(opts: {
  db: Db;
  connections: ProviderConnection[];
  /** Identity of the Assistant being searched. */
  assistant: Pick<Assistant, "id" | "organizationId">;
  /** The anchored Knowledge Collection, or null for assistant-wide. */
  collectionId: string | null;
  /**
   * Conversation for usage attribution. Null for synthetic traffic (goal
   * evals) that has no Conversation row, usage is still metered, just without
   * a conversation id.
   */
  conversationId: string | null;
  /**
   * Who the query embedding's and the rerank's credits belong to (#849). A
   * search is spent by whoever asked, not by retrieval itself, so the caller
   * says.
   */
  usage?: { spenders?: UsageSpenders; surface?: UsageSurface };
  /** Study requests can arrive immediately after uploading their material. */
  waitForIndexing?: boolean;
  /** Test seam; production builds the platform reranker. */
  reranker?: Reranker;
}): KnowledgeSearcher {
  const { db, assistant, collectionId, conversationId } = opts;
  const attribution = {
    db,
    organizationId: assistant.organizationId,
    assistantId: assistant.id,
    conversationId,
    spenders: opts.usage?.spenders,
    surface: opts.usage?.surface,
  };
  const embed = createEmbedder(opts.connections, attribution);
  const reranked = opts.reranker ?? createReranker({ attribution });
  const search: KnowledgeSearcher = async (query, options) => {
    const scoped = options?.scope === "assistant" ? null : collectionId;
    const embedding = await embed(query);
    const candidates = await db.searchChunks(assistant.id, scoped, {
      embedding,
      text: query,
      limit: RERANK_CANDIDATES,
      // The query's space: the matcher compares only within it (#801, CYB-14).
      embeddingSpace: embeddingSpaceId(opts.connections),
    });
    return reranked(query, candidates, KNOWLEDGE_SEARCH_LIMIT);
  };
  if (!opts.waitForIndexing) return search;

  // An upload is visible before its staged Concepts are committed. An empty
  // search during that window does not mean the material is absent. Share one
  // bounded wait per scope across batched queries (and subsequent tool calls).
  const readiness = new Map<string, Promise<boolean>>();
  const awaitIndexing = (scoped: string | null) => {
    const key = scoped ?? "";
    let waiting = readiness.get(key);
    if (!waiting) {
      waiting = (async () => {
        const ids = await db.listAssistantSourceIds(assistant.id);
        const sources = await Promise.all(ids.map((id) => db.getSource(id)));
        let pending = sources.filter((source) =>
          source?.status === "processing" &&
          (!scoped || source.collectionId === scoped)
        );
        if (pending.length === 0) return false;
        const deadline = Date.now() + 10_000;
        while (pending.length && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          pending = (await Promise.all(pending.map((source) => db.getSource(source!.id))))
            .filter((source) => source?.status === "processing");
        }
        if (pending.length) {
          throw new Error("Study material is still being processed. Please wait until the upload is ready, then try the exercise again.");
        }
        return true;
      })();
      readiness.set(key, waiting);
    }
    return waiting;
  };
  return async (query, options) => {
    const results = await search(query, options);
    if (results.length) return results;
    const scoped = options?.scope === "assistant" ? null : collectionId;
    return await awaitIndexing(scoped) ? search(query, options) : results;
  };
}

/**
 * The Teammate's searcher (#768): the same hybrid retrieval, scoped by a
 * Knowledge Scope instead of by an Assistant's linked Sources.
 *
 * A scope has two halves, whole Knowledge Collections and individual Library
 * Sources, and this is where they become one search. They are a **union**, run
 * concurrently over a single embedding, then deduplicated and re-ranked back
 * down to the one top-k, so a Source that also sits inside a scoped Collection
 * cannot spend two of the six slots on the same passage. Neither half knows the
 * other exists; the merge lives here because "what may this Teammate read" is
 * one question with one answer.
 *
 * The same rerank stage as the Assistant searcher (ADR-0025): each half returns
 * `RERANK_CANDIDATES`, the merged set is reranked to the one top-k, and the
 * citations are the same Concept → Source ones the widget produces.
 *
 * The caller is responsible for only building one when the scope is non-empty;
 * an empty scope means no search tool at all, not a search that finds nothing.
 */
export function buildCollectionSearcher(opts: {
  db: Db;
  connections: ProviderConnection[];
  organizationId: string;
  collectionIds: string[];
  /** Individual Library Sources in the scope; empty is the common case. */
  sourceIds: string[];
  conversationId: string | null;
  /** Who the query embedding's and the rerank's credits belong to (#849). */
  usage?: { spenders?: UsageSpenders; surface?: UsageSurface };
  /** Test seam; production builds the platform reranker. */
  reranker?: Reranker;
}): KnowledgeSearcher {
  const { db, organizationId, collectionIds, sourceIds, conversationId } = opts;
  const attribution = {
    db,
    organizationId,
    // No Assistant to attribute the spend to; the Teammate and the Member who
    // asked are on the spender tuple instead (#849).
    assistantId: null,
    conversationId,
    spenders: opts.usage?.spenders,
    surface: opts.usage?.surface,
  };
  const embed = createEmbedder(opts.connections, attribution);
  const reranked = opts.reranker ?? createReranker({ attribution });
  return async (query) => {
    // One embedding for both halves: the query is the same, and paying for it
    // twice would make a two-part scope cost double what a one-part scope does.
    const embedding = await embed(query);
    const q = {
      embedding,
      text: query,
      limit: RERANK_CANDIDATES,
      embeddingSpace: embeddingSpaceId(opts.connections),
    };
    const [byCollection, bySource] = await Promise.all([
      collectionIds.length > 0
        ? db.searchCollectionChunks(organizationId, collectionIds, q)
        : [],
      sourceIds.length > 0
        ? db.searchSourceChunks(organizationId, sourceIds, q)
        : [],
    ]);
    // The overwhelmingly common shapes, kept free of the merge so a
    // Collections-only Teammate behaves exactly as it did before scopes grew a
    // second half.
    if (bySource.length === 0) return reranked(query, byCollection, KNOWLEDGE_SEARCH_LIMIT);
    if (byCollection.length === 0) return reranked(query, bySource, KNOWLEDGE_SEARCH_LIMIT);

    const seen = new Set<string>();
    const merged = [...byCollection, ...bySource]
      .filter((hit) => {
        // Concept + passage, the same identity the two adapters dedupe hybrid
        // hits by: the same chunk reached twice is one result.
        const key = `${hit.conceptId}\n${hit.content}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, RERANK_CANDIDATES);
    return reranked(query, merged, KNOWLEDGE_SEARCH_LIMIT);
  };
}
