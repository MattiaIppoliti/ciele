/**
 * The knowledge search's rerank stage (ADR-0025): the hybrid index returns
 * {@link RERANK_CANDIDATES} passages and a cross-encoder picks the six the
 * model sees.
 *
 * On a 100-question bench over course readings this moved the right passage to
 * the top from 70% of questions to 100%, and "every fact the answer needs is in
 * the six" from 82% to 94%, for ~0.5 s median added latency. No other
 * retrieval change on that bench (BM25 fusion, HyDE, contextual headers) moved
 * either number once this was in.
 *
 * Three rules this module owns:
 *  - **Fail open to the hybrid order.** No Gateway key, a provider error or a
 *    timeout returns the first `limit` candidates exactly as the index ranked
 *    them. A search never fails because the reranker did.
 *  - **Platform credential only.** The reranker is reached through
 *    `AI_GATEWAY_API_KEY` and nothing else; it never reads a Provider
 *    Connection, so a Member's personal subscription cannot fund it
 *    (ADR-0001, ADR-0007). A widget Visitor's search is platform traffic.
 *  - **Order only.** The reranked results are the same objects the index
 *    returned, so citations (Concept → Source) and every downstream consumer
 *    see today's shape. `similarity` keeps the retrieval score.
 *
 * Internal module: the barrels do not export it. `retrieval.ts` is its only
 * caller.
 */

import { createGateway, rerank, type RerankingModel } from "ai";
import type {
  KnowledgeSearchResult,
  UsageSpenders,
  UsageSurface,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { alertKeys, signalHealth } from "./health";
import { meterUsage } from "./usage";

/** How many hybrid candidates the reranker chooses the six from. */
export const RERANK_CANDIDATES = 20;

/**
 * The reranking model. `voyage/rerank-2.5-lite` is the fallback option: 98% /
 * 88% on the same two sets, at 40% of the price.
 */
export const RERANK_MODEL = "voyage/rerank-2.5";

/**
 * Past this the search goes on without the reranker. The bench's p90 through
 * the Gateway was 0.55 s, so 1.5 s is a stalled call, not a slow one.
 */
export const RERANK_TIMEOUT_MS = 1_500;

/**
 * Consecutive fail-open searches, per Organization and process, before a
 * `system` Alert. One timeout is weather; five in a row is an outage.
 */
export const RERANK_FAILURES_BEFORE_ALERT = 5;

const GATEWAY_ENV = "AI_GATEWAY_API_KEY";

/** Who a rerank call's cost belongs to: the same tuple the query embedding uses. */
export interface RerankAttribution {
  db: Db;
  organizationId: string;
  assistantId: string | null;
  conversationId: string | null;
  spenders?: UsageSpenders;
  surface?: UsageSurface;
}

export type Reranker = (
  query: string,
  candidates: KnowledgeSearchResult[],
  limit: number
) => Promise<KnowledgeSearchResult[]>;

/** The platform reranking model, or null when this deployment has no Gateway key. */
export function platformRerankingModel(): RerankingModel | null {
  const apiKey = process.env[GATEWAY_ENV];
  return apiKey ? createGateway({ apiKey }).rerankingModel(RERANK_MODEL) : null;
}

// Per process, keyed by Organization. A serverless instance that never saw a
// failure still sends one healthy signal per Organization, so an Alert raised
// by another instance clears once reranking works again.
const consecutiveFailures = new Map<string, number>();
const reportedHealthy = new Set<string>();
let warnedNoKey = false;

/** Test seam: forgets the per-process failure tally. */
export function resetRerankHealthForTests(): void {
  consecutiveFailures.clear();
  reportedHealthy.clear();
  warnedNoKey = false;
}

export function createReranker(opts: {
  attribution: RerankAttribution;
  /** Injected in tests; production resolves the platform model once per searcher. */
  resolveModel?: () => RerankingModel | null;
  timeoutMs?: number;
}): Reranker {
  const { attribution } = opts;
  const timeoutMs = opts.timeoutMs ?? RERANK_TIMEOUT_MS;
  let model: RerankingModel | null | undefined;

  return async (query, candidates, limit) => {
    const fallback = candidates.slice(0, limit);
    // Nothing to choose between: reranking would only cost money.
    if (candidates.length <= 1) return fallback;
    if (model === undefined) model = (opts.resolveModel ?? platformRerankingModel)();
    if (!model) {
      if (!warnedNoKey) {
        warnedNoKey = true;
        console.warn(
          `[rerank] ${GATEWAY_ENV} is not set; knowledge search keeps the hybrid order.`
        );
      }
      return fallback;
    }

    const documents = candidates.map(rerankDocument);
    try {
      const result = await rerank({
        model,
        query,
        documents,
        topN: limit,
        // One attempt: a retry inside a 1.5 s budget only moves the timeout.
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(timeoutMs),
      });
      await meterUsage(attribution.db, [
        {
          organizationId: attribution.organizationId,
          assistantId: attribution.assistantId,
          conversationId: attribution.conversationId,
          stage: "rerank",
          provider: "voyage",
          modelId: RERANK_MODEL,
          credentialKind: "platform",
          inputTokens:
            billedTokens(result.providerMetadata) ?? estimateRerankTokens(query, documents),
          outputTokens: 0,
          spenders: attribution.spenders,
          surface: attribution.surface ?? null,
        },
      ]);
      const reranked = result.ranking
        .map((entry) => candidates[entry.originalIndex])
        .filter((hit): hit is KnowledgeSearchResult => hit !== undefined)
        .slice(0, limit);
      await recordOutcome(attribution, true);
      // A ranking that named no candidate is a malformed response, not "no
      // results": the index found passages, so the Visitor gets them.
      return reranked.length > 0 ? reranked : fallback;
    } catch (error) {
      console.warn("[rerank] fell back to the hybrid order:", error);
      await recordOutcome(attribution, false);
      return fallback;
    }
  };
}

/**
 * What the reranker reads for one passage: the passage alone. The bench this
 * stage was chosen on reranked bare chunks, and per-chunk headers were tested
 * separately and bought nothing, so a title prefix would be an unmeasured
 * change.
 */
function rerankDocument(hit: KnowledgeSearchResult): string {
  return hit.content;
}

/**
 * `RerankResult` carries no `usage`. Read a token count from the provider
 * metadata if the Gateway reports one under any namespace; otherwise the caller
 * estimates.
 */
function billedTokens(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== "object") return null;
  for (const namespace of Object.values(metadata as Record<string, unknown>)) {
    if (!namespace || typeof namespace !== "object") continue;
    const ns = namespace as Record<string, unknown>;
    const usage = (ns.usage && typeof ns.usage === "object" ? ns.usage : ns) as Record<
      string,
      unknown
    >;
    for (const key of ["totalTokens", "total_tokens", "tokens"]) {
      const value = usage[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
    }
  }
  return null;
}

/**
 * An estimate, used only when the provider reports no count: Voyage bills a
 * rerank as the query's tokens once per document plus the documents' own, and
 * ~4 characters make a token for the Latin-script text this runs on. It will
 * be off for other scripts; the ledger row is priced at list rate either way.
 */
export function estimateRerankTokens(query: string, documents: string[]): number {
  const chars =
    query.length * documents.length +
    documents.reduce((total, document) => total + document.length, 0);
  return Math.ceil(chars / 4);
}

async function recordOutcome(attribution: RerankAttribution, ok: boolean): Promise<void> {
  const org = attribution.organizationId;
  const key = alertKeys.rerank(org);
  if (ok) {
    const hadFailures = (consecutiveFailures.get(org) ?? 0) > 0;
    consecutiveFailures.delete(org);
    if (hadFailures || !reportedHealthy.has(org)) {
      reportedHealthy.add(org);
      await signalHealth(attribution.db, org, { key, healthy: true }, "rerank");
    }
    return;
  }
  const failures = (consecutiveFailures.get(org) ?? 0) + 1;
  consecutiveFailures.set(org, failures);
  if (failures === RERANK_FAILURES_BEFORE_ALERT) {
    await signalHealth(
      attribution.db,
      org,
      {
        key,
        healthy: false,
        alert: {
          type: "system",
          title: "Knowledge search is not reranking",
          detail: `The last ${failures} knowledge searches could not reach the reranker (${RERANK_MODEL}) and used the hybrid order instead. Answers still work but may cite weaker passages. This clears after the next reranked search.`,
        },
      },
      "rerank"
    );
  }
}
