/**
 * The Graph Knowledge Engine's retrieval seam (ADR-0017). Wraps the pgvector
 * `KnowledgeSearcher` so that, when an assistant's engine is `graph` and the
 * graph worker is reachable, `search_knowledge` retrieves from the derived
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
 * and the worker's QA id for the turn is surfaced via `onTrace`, the substrate
 * the feedback loop (#389) later scores.
 */

import type { KnowledgeSearchResult } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import {
  type GraphProvenance,
  isGraphWorkerConfigured,
  searchGraph,
} from "./graph-worker";
import type { KnowledgeSearcher } from "./types";

/**
 * Hydrates graph provenance entries into full `KnowledgeSearchResult`s using
 * OKF as the source of truth: each entry's `conceptId` resolves to the live
 * Concept (title/path/collection/source/resource), with the graph excerpt as
 * content. Entries whose Concept no longer exists are dropped (the graph lags a
 * delete). Dedupes by conceptId, preserving graph order; similarity descends by
 * rank so downstream ordering is stable.
 *
 * When `assistantId` is given, results obey the same link contract as vector
 * retrieval (PRD #726): a Concept whose Source is not linked to the assistant
 * is dropped (the graph indexes the whole Collection, which may hold Sources
 * linked elsewhere), and each surviving hit is stamped with `sourceId` +
 * `directAccess` so the runtime can offer the original file.
 */
export async function hydrateGraphProvenance(
  db: Db,
  provenance: GraphProvenance[],
  assistantId?: string | null
): Promise<KnowledgeSearchResult[]> {
  // Dedupe by conceptId up front, preserving graph order.
  const seen = new Set<string>();
  const entries = provenance.filter((entry) => {
    if (!entry.conceptId || seen.has(entry.conceptId)) return false;
    seen.add(entry.conceptId);
    return true;
  });
  if (entries.length === 0) return [];

  // Hydration runs on the interactive turn path, so it fans out in two waves
  // (concepts, then collections+sources, the latter memoized, results usually
  // share one Collection) instead of the serial per-entry loop this replaced,
  // which cost ~2 round trips per result.
  const concepts = await Promise.all(
    entries.map((entry) => db.getConcept(entry.conceptId as string))
  );
  const collectionCache = new Map<string, ReturnType<Db["getCollection"]>>();
  const getCollection = (id: string) => {
    let pending = collectionCache.get(id);
    if (!pending) {
      pending = db.getCollection(id);
      collectionCache.set(id, pending);
    }
    return pending;
  };
  // Memoized per Source: hydrated results usually share a handful of Sources.
  const linkCache = new Map<string, ReturnType<Db["listSourceAssistantLinks"]>>();
  const getLinks = (sourceId: string) => {
    let pending = linkCache.get(sourceId);
    if (!pending) {
      pending = db.listSourceAssistantLinks(sourceId);
      linkCache.set(sourceId, pending);
    }
    return pending;
  };
  const hydrated = await Promise.all(
    concepts.map(async (concept, i) => {
      if (!concept) return null;
      const [collection, source, links] = await Promise.all([
        getCollection(concept.collectionId),
        concept.sourceId ? db.getSource(concept.sourceId) : Promise.resolve(null),
        assistantId && concept.sourceId
          ? getLinks(concept.sourceId)
          : Promise.resolve(null),
      ]);
      const link = assistantId
        ? (links ?? []).find((l) => l.assistantId === assistantId) ?? null
        : null;
      // Link contract: with an assistant in scope, only linked Sources answer.
      if (assistantId && !link) return null;
      return { concept, collection, source, link, excerpt: entries[i].excerpt };
    })
  );

  const results: KnowledgeSearchResult[] = [];
  for (const row of hydrated) {
    if (!row) continue; // The graph lags a delete, drop vanished Concepts.
    const { concept, collection, source, link, excerpt } = row;
    results.push({
      conceptId: concept.id,
      conceptTitle: concept.frontmatter.title ?? concept.path,
      conceptPath: concept.path,
      collectionId: concept.collectionId,
      collectionName: collection?.name ?? "",
      sourceName: source?.name ?? null,
      sourceId: concept.sourceId ?? null,
      // Same gate as the vector path: flag on the link, file kind, original kept.
      directAccess:
        source?.kind === "file" &&
        source.originalObjectPath !== null &&
        link?.directAccess === true,
      resourceUrl: concept.frontmatter.resource ?? null,
      content: excerpt,
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
 * How long an interactive turn waits for the graph before falling back to
 * vector. The worker's `chunks`-mode search is a local vector lookup on its
 * side, when it has not answered in this window, waiting longer only delays
 * the same fallback the error path already takes. Deliberately far below the
 * worker client's 60s default, which sizing suits the off-path jobs.
 */
export const INTERACTIVE_GRAPH_SEARCH_TIMEOUT_MS = 10_000;

/**
 * Wraps a vector `KnowledgeSearcher` with the graph engine. When `useGraph` is
 * true and the search is scoped to a concrete collection, it retrieves from the
 * graph and hydrates provenance to citations; on any error, or for an
 * assistant-wide widen, it delegates to `vector`. `onTrace` receives the graph
 * QA id for a successful graph search (feedback substrate).
 *
 * No usage metering here: the only mode this path requests is `chunks`, which
 * makes zero worker LLM calls, enabling `graph_completion` on the turn path
 * must reintroduce a `graph_search`-stage meter alongside it.
 */
export function withGraphEngine(opts: {
  db: Db;
  /**
   * The querying assistant: graph hits are filtered to Sources linked to it
   * and stamped with `directAccess`, mirroring vector retrieval. Null skips
   * the link filter (no assistant in scope, e.g. maintenance tooling).
   */
  assistantId?: string | null;
  collectionId: string | null;
  /**
   * Conversation for usage attribution and the graph session (Retrieval
   * Trace). Null for synthetic traffic with no Conversation row, the graph
   * still answers, it just records no per-conversation trace.
   */
  conversationId: string | null;
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
          sessionId: opts.conversationId ?? undefined,
          timeoutMs: INTERACTIVE_GRAPH_SEARCH_TIMEOUT_MS,
        });
        const hydrated = await hydrateGraphProvenance(
          opts.db,
          result.provenance,
          opts.assistantId ?? null
        );
        // An empty graph (e.g. a collection not yet ingested) should not starve
        // the answer, fall back to vector when the graph yields nothing.
        if (hydrated.length > 0) {
          // Report the trace only when the graph actually answers, so the
          // feedback substrate (#389) never binds a graph QA id to a
          // vector-served answer.
          if (result.qaId) opts.onTrace?.(result.qaId);
          return hydrated;
        }
      } catch (error) {
        // Fall through to vector: the widget never stops answering, but leave
        // a breadcrumb; a persistently failing graph is an operational signal.
        console.error("[runtime] graph search failed; using vector:", error);
      }
    }
    return opts.vector(query, options);
  };
}
