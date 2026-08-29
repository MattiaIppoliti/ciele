/**
 * The ONE way a `KnowledgeSearcher` is built (#c2 of the 2026-08 architecture
 * review). Before this factory existed, the `embedText → db.searchChunks`
 * closure was hand-written at four call sites, the live turn, the handover
 * continuation, the standing-goal evals and the Suggested Fix job, and two of
 * the copies silently bypassed the Knowledge Engine choice (`withGraphEngine`),
 * so the loop meant to catch retrieval regressions exercised a retrieval path
 * production never used.
 *
 * The factory owns, in one place:
 *  - the scope-tier widen (#155): an "assistant" pass drops the anchored
 *    Collection filter; `searchChunks` treats a null collection as
 *    assistant-wide,
 *  - one lazily-resolved embedding client per searcher (credential decrypt and
 *    provider construction happen once per turn, not once per query),
 *  - the Knowledge Engine choice (ADR-0017): Graph is primary, vector is the
 *    same-call fallback, applied for EVERY caller, so synthetic traffic tests
 *    the path a widget Visitor actually gets.
 *
 * Internal module: the barrels do not export it. Callers outside the runtime
 * hand `streamConversationTurn` config, never searchers.
 */

import type { Assistant, ProviderConnection } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { createEmbedder } from "./embeddings";
import { withGraphEngine } from "./graph-search";
import type { KnowledgeSearcher } from "./types";

/** How many chunks one search pass returns, the one top-k for knowledge. */
export const KNOWLEDGE_SEARCH_LIMIT = 6;

export function buildKnowledgeSearcher(opts: {
  db: Db;
  connections: ProviderConnection[];
  /** Identity + engine choice of the Assistant being searched. */
  assistant: Pick<Assistant, "id" | "organizationId" | "knowledgeEngine">;
  /** The anchored Knowledge Collection, or null for assistant-wide. */
  collectionId: string | null;
  /**
   * Conversation for usage attribution and the graph Retrieval Trace. Null for
   * synthetic traffic (goal evals) that has no Conversation row, usage is
   * still metered, just without a conversation id.
   */
  conversationId: string | null;
  /** Receives the graph QA id when a graph search served results (#389). */
  onTrace?: (qaId: string) => void;
}): KnowledgeSearcher {
  const { db, assistant, collectionId, conversationId } = opts;
  const embed = createEmbedder(opts.connections, {
    db,
    organizationId: assistant.organizationId,
    assistantId: assistant.id,
    conversationId,
  });
  const vector: KnowledgeSearcher = async (query, options) => {
    const scoped = options?.scope === "assistant" ? null : collectionId;
    const embedding = await embed(query);
    return db.searchChunks(assistant.id, scoped, {
      embedding,
      text: query,
      limit: KNOWLEDGE_SEARCH_LIMIT,
    });
  };
  return withGraphEngine({
    db,
    assistantId: assistant.id,
    collectionId,
    conversationId,
    useGraph: (assistant.knowledgeEngine ?? "graph") === "graph",
    vector,
    onTrace: opts.onTrace,
  });
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
 * Deliberately not routed through `withGraphEngine`: the Knowledge Graph is
 * derived per Assistant (ADR-0017), and a Teammate is not one, so this is the
 * pgvector path with the same embedding client, the same top-k, and the same
 * Concept → Source citations the widget produces.
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
}): KnowledgeSearcher {
  const { db, organizationId, collectionIds, sourceIds, conversationId } = opts;
  const embed = createEmbedder(opts.connections, {
    db,
    organizationId,
    // No Assistant to attribute the embedding spend to; the Organization and
    // the Conversation are the whole attribution for internal traffic.
    assistantId: null,
    conversationId,
  });
  return async (query) => {
    // One embedding for both halves: the query is the same, and paying for it
    // twice would make a two-part scope cost double what a one-part scope does.
    const embedding = await embed(query);
    const q = { embedding, text: query, limit: KNOWLEDGE_SEARCH_LIMIT };
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
    if (bySource.length === 0) return byCollection;
    if (byCollection.length === 0) return bySource;

    const seen = new Set<string>();
    return [...byCollection, ...bySource]
      .filter((hit) => {
        // Concept + passage, the same identity the two adapters dedupe hybrid
        // hits by: the same chunk reached twice is one result.
        const key = `${hit.conceptId}\n${hit.content}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, KNOWLEDGE_SEARCH_LIMIT);
  };
}
