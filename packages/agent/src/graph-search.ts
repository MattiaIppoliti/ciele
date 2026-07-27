/**
 * The Graph Knowledge Engine's retrieval seam (ADR-0017). Wraps the pgvector
 * `KnowledgeSearcher` so that — when an assistant's engine is `graph` and the
 * graph worker is reachable — `search_knowledge` retrieves from the derived
 * Knowledge Graph instead, then hydrates each result back to a **Concept →
 * Source** citation so the runtime's answer/citation machinery is unchanged.
 *
 * Two load-bearing rules:
 *  - **Same-turn fallback.** Any graph error (worker down, timeout, malformed
 *    payload) falls through to the vector searcher within the same call, so the
 *    widget never stops answering.
 *  - **Per-collection datasets.** The graph is keyed by collectionId, so an
 *    assistant-wide widen (`scope: "assistant"`, null collection) has no single
 *    dataset to target and uses vector. Concrete-collection searches use graph.
 *
 * Passing the conversation id as the graph session records a Retrieval Trace,
 * and the worker's QA id for the turn is surfaced via `onTrace` — the substrate
 * the feedback loop (#389) later scores.
 */

import type { KnowledgeSearchResult } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import {
  type GraphProvenance,
  graphUsageProvider,
  isGraphWorkerConfigured,
  searchGraph,
} from "./graph-worker";
import type { KnowledgeSearcher } from "./types";
import { meterUsage } from "./usage";

/**
 * Hydrates graph provenance entries into full `KnowledgeSearchResult`s using
 * OKF as the source of truth: each entry's `conceptId` resolves to the live
 * Concept (title/path/collection/source/resource), with the graph excerpt as
 * content. Entries whose Concept no longer exists are dropped (the graph lags a
 * delete). Dedupes by conceptId, preserving graph order; similarity descends by
 * rank so downstream ordering is stable.
 */
export async function hydrateGraphProvenance(
  db: Db,
  provenance: GraphProvenance[]
): Promise<KnowledgeSearchResult[]> {
  const seen = new Set<string>();
  // Memoize collection lookups: a search's results usually share one Collection,
  // so this avoids re-fetching the same one per result.
  const collectionCache = new Map<string, Awaited<ReturnType<Db["getCollection"]>>>();
  const getCollection = async (id: string) => {
    if (!collectionCache.has(id)) collectionCache.set(id, await db.getCollection(id));
    return collectionCache.get(id) ?? null;
  };
  const results: KnowledgeSearchResult[] = [];
  for (const entry of provenance) {
    if (!entry.conceptId || seen.has(entry.conceptId)) continue;
    seen.add(entry.conceptId);
    const concept = await db.getConcept(entry.conceptId);
    if (!concept) continue;
    const [collection, source] = await Promise.all([
      getCollection(concept.collectionId),
      concept.sourceId ? db.getSource(concept.sourceId) : Promise.resolve(null),
    ]);
    results.push({
      conceptId: concept.id,
      conceptTitle: concept.frontmatter.title ?? concept.path,
      conceptPath: concept.path,
      collectionId: concept.collectionId,
      collectionName: collection?.name ?? "",
      sourceName: source?.name ?? null,
      resourceUrl: concept.frontmatter.resource ?? null,
      content: entry.excerpt,
      // Rank-descending in (0,1] (first entry = 1); keeps graph order for any
      // downstream score-aware consumer without inventing a real relevance score.
      // `engine` is what stops that placeholder being read as one: the coverage
      // gate branches on it instead of comparing 1.0 against a cosine threshold
      // (which would score every non-empty graph result "sufficient").
      similarity: 1 - results.length / (provenance.length + 1),
      engine: "graph",
    });
  }
  return results;
}

/**
 * Wraps a vector `KnowledgeSearcher` with the graph engine. When `useGraph` is
 * true and the search is scoped to a concrete collection, it retrieves from the
 * graph and hydrates provenance to citations; on any error, or for an
 * assistant-wide widen, it delegates to `vector`. `onTrace` receives the graph
 * QA id for a successful graph search (feedback substrate). Any LLM usage the
 * worker reports for the search (e.g. session-guidance extraction) is metered
 * into the ai_usage ledger under `graph_search`, attributed to the
 * org/assistant/conversation.
 */
export function withGraphEngine(opts: {
  db: Db;
  organizationId: string;
  assistantId: string;
  collectionId: string | null;
  conversationId: string;
  useGraph: boolean;
  vector: KnowledgeSearcher;
  onTrace?: (qaId: string) => void;
}): KnowledgeSearcher {
  return async (query, options) => {
    const scoped = options?.scope === "assistant" ? null : opts.collectionId;
    // Graph datasets are per-collection: only a concrete-collection search has a
    // dataset to target. Everything else (widen, unanchored, engine off, worker
    // down) is the vector path.
    if (opts.useGraph && scoped && isGraphWorkerConfigured()) {
      try {
        const result = await searchGraph(scoped, query, {
          mode: "chunks",
          sessionId: opts.conversationId,
        });
        // Meter before any fallback decision — the worker's LLM calls were
        // spent whether or not the graph result ends up serving the answer.
        if (result.usage) {
          await meterUsage(opts.db, [
            {
              organizationId: opts.organizationId,
              assistantId: opts.assistantId,
              conversationId: opts.conversationId,
              stage: "graph_search",
              provider: graphUsageProvider(result.usage),
              modelId: result.usage.modelId,
              // The worker answers on its own env-configured LLM key — the
              // deployment operator's credential, i.e. the funded bucket.
              credentialKind: "platform",
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
            },
          ]);
        }
        const hydrated = await hydrateGraphProvenance(opts.db, result.provenance);
        // An empty graph (e.g. a collection not yet ingested) should not starve
        // the answer — fall back to vector when the graph yields nothing.
        if (hydrated.length > 0) {
          // Report the trace only when the graph actually answers, so the
          // feedback substrate (#389) never binds a graph QA id to a
          // vector-served answer.
          if (result.qaId) opts.onTrace?.(result.qaId);
          return hydrated;
        }
      } catch (error) {
        // Fall through to vector — the widget never stops answering — but leave
        // a breadcrumb; a persistently failing graph is an operational signal.
        console.error("[runtime] graph search failed; using vector:", error);
      }
    }
    return opts.vector(query, options);
  };
}
