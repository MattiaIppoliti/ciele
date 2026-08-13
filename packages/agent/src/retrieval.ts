/**
 * The ONE way a `KnowledgeSearcher` is built (#c2 of the 2026-08 architecture
 * review). Before this factory existed, the `embedText → db.searchChunks`
 * closure was hand-written at four call sites — the live turn, the handover
 * continuation, the standing-goal evals and the Suggested Fix job — and two of
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
 *    same-call fallback — applied for EVERY caller, so synthetic traffic tests
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

/** How many chunks one search pass returns — the one top-k for knowledge. */
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
   * synthetic traffic (goal evals) that has no Conversation row — usage is
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
    collectionId,
    conversationId,
    useGraph: (assistant.knowledgeEngine ?? "graph") === "graph",
    vector,
    onTrace: opts.onTrace,
  });
}
