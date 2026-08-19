/**
 * Graph Knowledge Layer via a private cognee worker (its base URL + token come
 * from GRAPH_WORKER_BASE_URL / GRAPH_WORKER_API_TOKEN, never hardcode them).
 * The worker itself (a pinned, authenticated container wrapping the cognee
 * library behind ingest/search/feedback/improve/health routes) is packaged
 * separately under `services/graph-worker/`; this module is the Ciele-side
 * adapter that speaks its HTTP contract.
 *
 * The graph is a DERIVED retrieval + learning index over OKF Concepts, never
 * the system of record (see ADR-0017). Each Knowledge Collection maps to one
 * cognee dataset; every ingested document is tagged with the originating
 * `{ conceptId, sourceId, collectionId }` so a retrieval result can be mapped
 * back to a Concept → Source citation without ever exposing an opaque chunk
 * (the ADR-0002 invariant).
 *
 * A load-bearing operational rule from the spike (`docs/research/cognee-spike.md`):
 * every graph read must run inside the dataset's multi-tenant context or cognee
 * silently returns an empty default graph. This adapter makes that impossible to
 * get wrong by requiring a dataset on every call and letting the worker open the
 * context; there is no dataset-less entry point.
 *
 * Like the crawler adapter, request/response shapes are kept small and mapped as
 * pure transformations so the worker contract can be exercised off the network
 * here, while the live round-trip is verified by the worker's own smoke test.
 */

import type { Provider } from "@agent-hub/core";
import { redactBearerSecrets, trimTrailingSlash } from "./redact";

/** Prefix for cognee dataset names so every Ciele collection is namespaced and
 * distinguishable from any hand-created dataset on the same worker. */
const DATASET_PREFIX = "ciele_col_";

/** Default request timeouts (ms). Search/feedback are interactive; ingest and
 * improve are slower graph-building passes but still submitted synchronously,
 * the worker does the heavy lifting, we just wait for its ack. */
const SEARCH_TIMEOUT_MS = 60_000;
const WRITE_TIMEOUT_MS = 120_000;

export function isGraphWorkerConfigured(): boolean {
  return Boolean(process.env.GRAPH_WORKER_BASE_URL && process.env.GRAPH_WORKER_API_TOKEN);
}

/**
 * Scrubs worker credentials out of any text destined for an error, an Alert, a
 * client response, or telemetry, the configured token and any bearer/
 * authorization echo (see `redactBearerSecrets`, shared with the crawler
 * adapter).
 */
export function redactGraphWorkerSecrets(text: string): string {
  return redactBearerSecrets(text, process.env.GRAPH_WORKER_API_TOKEN);
}

/**
 * The cognee dataset name for a Knowledge Collection. Deterministic and
 * sanitized (cognee dataset names must be simple identifiers): the collection
 * id is lower-cased and any character outside `[a-z0-9_]` is replaced with `_`,
 * behind a fixed Ciele prefix. Pure, so the mapping is testable and stable.
 */
export function datasetForCollection(collectionId: string): string {
  const safe = collectionId.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return `${DATASET_PREFIX}${safe}`;
}

function requireConfig(): { baseUrl: string; token: string } {
  const baseUrl = process.env.GRAPH_WORKER_BASE_URL;
  const token = process.env.GRAPH_WORKER_API_TOKEN;
  if (!baseUrl || !token) {
    throw new Error(
      "GRAPH_WORKER_BASE_URL and GRAPH_WORKER_API_TOKEN must be set, required for the graph knowledge worker."
    );
  }
  return { baseUrl: trimTrailingSlash(baseUrl), token };
}

/**
 * A single request to the worker. Centralizes the Bearer auth (never in the
 * body or the returned value), the JSON envelope, the timeout, and the
 * redaction of any error detail. Returns the parsed JSON body on success.
 */
async function workerRequest<T>(
  path: string,
  body: unknown,
  timeoutMs: number
): Promise<T> {
  const { baseUrl, token } = requireConfig();
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Graph worker ${path} failed (${response.status}): ${redactGraphWorkerSecrets(detail).slice(0, 200)}`
    );
  }
  return (await response.json().catch(() => ({}))) as T;
}

/**
 * Token usage the worker reports for the LLM calls one request triggered
 * internally (cognify, graph-completion, session guidance, distillation),
 * cognee's HTTP payloads carry no usage of their own, so the worker meters its
 * litellm calls and returns the aggregate here for the ai_usage ledger.
 */
export interface GraphWorkerUsage {
  inputTokens: number;
  outputTokens: number;
  /** How many LLM calls the request triggered (0 = nothing to meter). */
  llmCalls: number;
  /** litellm model id that ran, e.g. "gemini/gemini-2.0-flash". */
  modelId: string;
  /** The worker's LLM_PROVIDER value (litellm naming, e.g. "gemini"). */
  provider: string;
}

/** Raw wire shape of the worker's usage object (snake_case, defensive). */
type RawUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  llm_calls?: number | null;
  model?: string | null;
  provider?: string | null;
} | null;

/**
 * Maps the worker's raw usage to `GraphWorkerUsage`, or null when the request
 * made no LLM calls (or the worker predates usage reporting), so callers meter
 * only real spend. Pure, unit-tested off the network like the other mappers.
 */
export function mapGraphUsage(raw: RawUsage | undefined): GraphWorkerUsage | null {
  const llmCalls = raw?.llm_calls ?? 0;
  if (!raw || llmCalls <= 0) return null;
  return {
    inputTokens: raw.input_tokens ?? 0,
    outputTokens: raw.output_tokens ?? 0,
    llmCalls,
    modelId: raw.model || "unknown",
    provider: raw.provider ?? "",
  };
}

/**
 * Folds the worker's litellm provider naming into the ledger's `Provider`
 * vocabulary: gemini/vertex → google, anthropic → anthropic, and everything
 * else (openai, azure, ollama, custom) → openai; those are all served over
 * OpenAI-compatible endpoints, and the ledger's provider column is
 * attribution, not billing truth (pricing keys on the model id).
 */
export function graphUsageProvider(usage: GraphWorkerUsage): Provider {
  const p = usage.provider.toLowerCase();
  if (p.includes("gemini") || p.includes("google") || p.includes("vertex")) return "google";
  if (p.includes("anthropic") || p.includes("claude")) return "anthropic";
  return "openai";
}

/** One document pushed into a collection's graph. `text` is the Concept body;
 * the tags let a later retrieval resolve provenance back to Concept → Source. */
export interface GraphDocument {
  conceptId: string;
  sourceId: string | null;
  text: string;
}

/**
 * Ingests (or re-ingests) Concepts into a collection's graph: `add` + `cognify`
 * on the worker, into the dataset for `collectionId`, tagging each document so
 * results stay attributable. Idempotent on `conceptId`, re-ingesting a Concept
 * replaces its graph document. The token never appears in the request body.
 */
export async function ingestConcepts(
  collectionId: string,
  documents: GraphDocument[]
): Promise<{ dataset: string; ingested: number; usage: GraphWorkerUsage | null }> {
  const dataset = datasetForCollection(collectionId);
  const result = await workerRequest<{ ingested?: number; usage?: RawUsage }>(
    "/ingest",
    {
      dataset,
      collection_id: collectionId,
      // Serialize the wire payload in one convention (snake_case) so the whole
      // worker contract is consistent; the in-code GraphDocument stays camelCase.
      documents: documents.map((d) => ({
        concept_id: d.conceptId,
        source_id: d.sourceId,
        text: d.text,
      })),
    },
    WRITE_TIMEOUT_MS
  );
  return {
    dataset,
    ingested: result.ingested ?? documents.length,
    usage: mapGraphUsage(result.usage),
  };
}

/** Removes a Concept's document from a collection's graph (on Concept delete). */
export async function removeConcept(
  collectionId: string,
  conceptId: string
): Promise<void> {
  const dataset = datasetForCollection(collectionId);
  await workerRequest("/remove", { dataset, concept_id: conceptId }, WRITE_TIMEOUT_MS);
}

/**
 * Drops a collection's *entire* cognee dataset (on Knowledge Collection or
 * Assistant delete). The dataset is keyed by `collectionId` and is never queried
 * again once the collection is gone, so reclaiming it in one call beats an
 * unbounded fan-out of per-Concept removes over what may be a large collection.
 * Best-effort on the worker: a dataset that was never created (no graph worker
 * when the collection was ingested, or nothing ever ingested) is a no-op, not an
 * error, mirroring `/remove`.
 */
export async function purgeCollection(collectionId: string): Promise<void> {
  const dataset = datasetForCollection(collectionId);
  await workerRequest("/purge", { dataset }, WRITE_TIMEOUT_MS);
}

/** How the graph should answer. `graph_completion` composes a prose answer with
 * evidence (multi-hop); `chunks` returns matched material without an LLM pass. */
export type GraphSearchMode = "graph_completion" | "chunks";

/** One piece of evidence behind a graph answer, mapped back to OKF provenance.
 * `conceptId`/`sourceId` come from the ingest-time document tags; `excerpt` is
 * the supporting chunk text. This is what a citation is built from. */
export interface GraphProvenance {
  conceptId: string | null;
  sourceId: string | null;
  excerpt: string;
}

/** A graph search result: the composed answer (empty for `chunks` mode), the
 * provenance behind it, the worker's QA id for this turn, the handle the
 * feedback loop later scores (see `sendFeedback`), and the LLM usage the
 * search cost (null when it made no LLM calls, e.g. pure `chunks` retrieval). */
export interface GraphSearchResult {
  answer: string;
  provenance: GraphProvenance[];
  qaId: string | null;
  usage: GraphWorkerUsage | null;
}

/** Raw worker search body; mapped defensively since cognee payload shapes drift
 * across releases (spike note). */
interface GraphSearchBody {
  answer?: string | null;
  qa_id?: string | null;
  provenance?: RawProvenance[] | null;
  usage?: RawUsage;
}

type RawProvenance = {
  concept_id?: string | null;
  source_id?: string | null;
  excerpt?: string | null;
} | null;

/**
 * Maps the worker's raw provenance entries to Concept → Source provenance:
 * trims excerpts, drops null and empty-excerpt entries. Pure, so the mapping
 * (the ADR-0002 citation seam) is unit-tested off the network.
 */
export function mapGraphProvenance(raw: RawProvenance[] | null | undefined): GraphProvenance[] {
  return (raw ?? [])
    .filter((p): p is NonNullable<RawProvenance> => Boolean(p))
    .map((p) => ({
      conceptId: p.concept_id ?? null,
      sourceId: p.source_id ?? null,
      excerpt: (p.excerpt ?? "").trim(),
    }))
    .filter((p) => p.excerpt.length > 0);
}

/**
 * Searches a collection's graph. Always runs against the dataset for
 * `collectionId` (never a dataset-less call, the empty-default-graph gotcha is
 * unreachable). Passing `sessionId` (the conversation id) makes the worker
 * record a Retrieval Trace so this answer's graph elements can later be
 * re-weighted by feedback. Evidence is mapped to Concept → Source provenance.
 */
export async function searchGraph(
  collectionId: string,
  query: string,
  options: {
    mode?: GraphSearchMode;
    sessionId?: string;
    topK?: number;
    /** Override for interactive callers; defaults to the worker search budget. */
    timeoutMs?: number;
  } = {}
): Promise<GraphSearchResult> {
  const dataset = datasetForCollection(collectionId);
  const body = await workerRequest<GraphSearchBody>(
    "/search",
    {
      dataset,
      query,
      mode: options.mode ?? "graph_completion",
      session_id: options.sessionId ?? null,
      top_k: options.topK ?? 6,
    },
    options.timeoutMs ?? SEARCH_TIMEOUT_MS
  );
  return {
    answer: (body.answer ?? "").trim(),
    qaId: body.qa_id ?? null,
    provenance: mapGraphProvenance(body.provenance),
    usage: mapGraphUsage(body.usage),
  };
}

/** A user's verdict on a graph answer. 👍 → 5, 👎 → 1 (cognee's 1–5 scale). */
export type GraphFeedbackScore = 1 | 5;

/**
 * Records feedback on a graph-served answer for the learning loop. `qaId` is the
 * handle returned by `searchGraph`; `text` carries an Improvement description
 * when a Member flags the answer. The worker applies the weight update later
 * (via `improveDataset`), so this call just registers the score.
 */
export async function sendFeedback(
  collectionId: string,
  input: { sessionId: string; qaId: string; score: GraphFeedbackScore; text?: string }
): Promise<void> {
  const dataset = datasetForCollection(collectionId);
  await workerRequest(
    "/feedback",
    {
      dataset,
      session_id: input.sessionId,
      qa_id: input.qaId,
      score: input.score,
      text: input.text ?? null,
    },
    SEARCH_TIMEOUT_MS
  );
}

/**
 * Runs the worker's improve pass for a collection's dataset: applies feedback
 * weights (the zero-LLM stage, always) and, when `distill` is set, the LLM
 * distillation stage. `distill` is gated by the caller against the org's daily
 * learning-token budget; this adapter only forwards the flag.
 */
export async function improveDataset(
  collectionId: string,
  options: { sessionIds?: string[]; distill?: boolean } = {}
): Promise<{
  weightedElements: number;
  boosted: number;
  demoted: number;
  usage: GraphWorkerUsage | null;
}> {
  const dataset = datasetForCollection(collectionId);
  const result = await workerRequest<{
    weighted_elements?: number;
    boosted?: number;
    demoted?: number;
    usage?: RawUsage;
  }>(
    "/improve",
    {
      dataset,
      session_ids: options.sessionIds ?? null,
      distill: options.distill ?? false,
    },
    WRITE_TIMEOUT_MS
  );
  return {
    weightedElements: result.weighted_elements ?? 0,
    boosted: result.boosted ?? 0,
    demoted: result.demoted ?? 0,
    usage: mapGraphUsage(result.usage),
  };
}

// A `getGraphWorkerHealth` liveness probe used to live here, its docstring
// promising an Alerts producer that was never wired. The graph Alert is raised
// reactively from feedback/learning failures (graph-feedback.ts); a proactive
// probe returns with whichever producer actually polls the worker's /health.
