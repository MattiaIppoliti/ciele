import type {
  KnowledgeSearchResult,
  ProviderConnection,
  UsageSpenders,
  UsageSurface,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { buildCollectionSearcher, buildKnowledgeSearcher } from "./retrieval";

/**
 * Knowledge search without a Conversation Turn: the passages and their
 * Sources, for a caller that brings its own model (an MCP client, a script).
 *
 * The same retrieval a turn runs, through the one searcher factory
 * (`retrieval.ts`), so an outside caller gets exactly the six passages the
 * widget would have cited, reranked the same way (ADR-0025). What it does not
 * do is everything a turn adds: no Conversation, no transcript, no answer
 * generation, which is also why it stays out of the Inbox and the Insights
 * population (ADR-0010) by construction rather than by a filter.
 *
 * Two scopes. With an Assistant, the Sources linked to it, the corpus its
 * widget answers from. Without one, the whole Library: every Collection of
 * the Organization.
 */
export async function searchKnowledge(opts: {
  db: Db;
  connections: ProviderConnection[];
  organizationId: string;
  query: string;
  /** Null searches the whole Library. The caller checked the Assistant's org. */
  assistantId: string | null;
  /** Who the query embedding's and the rerank's credits belong to (#849). */
  usage?: { spenders?: UsageSpenders; surface?: UsageSurface };
}): Promise<KnowledgeSearchResult[]> {
  const { db, connections, organizationId, query, usage } = opts;
  if (opts.assistantId) {
    const search = buildKnowledgeSearcher({
      db,
      connections,
      assistant: { id: opts.assistantId, organizationId },
      collectionId: null,
      conversationId: null,
      usage,
    });
    return search(query, { scope: "assistant" });
  }
  const collections = await db.listOrgCollections(organizationId);
  // An Organization with no Collection has nothing to search, and the
  // Collection searcher is only built for a non-empty scope.
  if (collections.length === 0) return [];
  const search = buildCollectionSearcher({
    db,
    connections,
    organizationId,
    collectionIds: collections.map((collection) => collection.id),
    sourceIds: [],
    conversationId: null,
    usage,
  });
  return search(query);
}
