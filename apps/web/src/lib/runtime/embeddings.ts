import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { embed, embedMany, type EmbeddingModel } from "ai";
import type {
  Db,
  Provider,
  ProviderConnection,
  ProviderConnectionProvider,
} from "@agent-hub/db";
import { canEmbedWithConnection } from "./embedding-capability";
import { createGoogleVertexProvider } from "./google-vertex";
import { resolveProviderCredential, type ProviderCredential } from "./models";
import { meterUsage } from "./usage";

export const EMBEDDING_DIMS = 1536;

/**
 * Normalizes any provider's embedding to the shared 1536-dim pgvector column:
 * zero-pad shorter vectors, truncate longer ones. Cosine similarity is
 * unaffected by trailing zeros, so one column + HNSW index serves all
 * providers (ARCHITECTURE §7). Exported so the invariant is directly tested.
 */
export function padEmbedding(vector: number[]): number[] {
  if (vector.length === EMBEDDING_DIMS) return vector;
  if (vector.length > EMBEDDING_DIMS) return vector.slice(0, EMBEDDING_DIMS);
  return [...vector, ...new Array(EMBEDDING_DIMS - vector.length).fill(0)];
}

/**
 * Attribution for the AI usage ledger: every embedding call is a billable
 * model call, so callers say which org (and, when known, assistant /
 * conversation) it runs for. `null` is an explicit opt-out for contexts that
 * genuinely have no organization — not a default.
 */
export interface EmbeddingUsageContext {
  db: Db;
  organizationId: string;
  assistantId?: string | null;
  conversationId?: string | null;
}

interface ResolvedEmbeddingModel {
  model: EmbeddingModel;
  provider: Provider;
  modelId: string;
  credentialKind: ProviderCredential["kind"];
}

/**
 * Providers with an embeddings API, in the order tried when an Organization
 * has not picked a connection. Anthropic has none, so it never appears.
 */
const AUTOMATIC_EMBEDDING_ORDER: Provider[] = [
  "openai",
  "google",
  "openai_compatible",
];

/**
 * Builds the embedding model a provider offers from the given connections.
 * Null → this provider cannot embed here (no key, no embeddings API), which
 * the callers turn into the lexical-search fallback. Carries the resolved
 * provider/model/credential so the call can be metered.
 */
function embeddingModelForProvider(
  provider: ProviderConnectionProvider,
  connections: ProviderConnection[]
): ResolvedEmbeddingModel | null {
  if (provider === "openai") return openAiEmbedding(connections);
  if (provider === "google") return googleEmbedding(connections);
  if (provider === "openai_compatible") return compatibleEmbedding(connections);
  return null;
}

/**
 * The embedding model for a set of connections.
 *
 * An Organization can pick which connection embeds its knowledge (#437); when
 * it has, that choice is **authoritative** — if the chosen connection cannot
 * embed, retrieval falls back to lexical search rather than quietly embedding
 * with a different model. Mixing models inside one Knowledge Collection puts
 * chunks in incomparable vector spaces, which is the failure the picker
 * exists to prevent. With no choice made, the automatic order applies exactly
 * as before.
 */
function getEmbeddingModel(
  connections: ProviderConnection[]
): ResolvedEmbeddingModel | null {
  const chosen = connections.find((c) => c.preferredForEmbedding);
  if (chosen) {
    // Resolved against the chosen connection alone, so a same-provider
    // sibling connection cannot stand in for it. The same predicate the
    // settings UI filters with decides whether it can embed at all, so the
    // two can never disagree about what is offerable.
    const resolved = canEmbedWithConnection(chosen)
      ? embeddingModelForProvider(chosen.provider, [chosen])
      : null;
    if (!resolved) {
      console.warn(
        `[embeddings] chosen connection ${chosen.id} (${chosen.provider}) cannot embed — falling back to lexical search`
      );
    }
    return resolved;
  }
  for (const provider of AUTOMATIC_EMBEDDING_ORDER) {
    const resolved = embeddingModelForProvider(provider, connections);
    if (resolved) return resolved;
  }
  return null;
}

function openAiEmbedding(
  connections: ProviderConnection[]
): ResolvedEmbeddingModel | null {
  const openaiCredential = resolveProviderCredential("openai", connections);
  if (
    openaiCredential &&
    "apiKey" in openaiCredential &&
    typeof openaiCredential.apiKey === "string"
  ) {
    return {
      model: createOpenAI({ apiKey: openaiCredential.apiKey }).embedding(
        "text-embedding-3-small"
      ),
      provider: "openai",
      modelId: "text-embedding-3-small",
      credentialKind: openaiCredential.kind,
    };
  }
  return null;
}

function googleEmbedding(
  connections: ProviderConnection[]
): ResolvedEmbeddingModel | null {
  const googleCredential = resolveProviderCredential("google", connections);
  if (googleCredential?.kind === "google_vertex_federated") {
    return {
      model: createGoogleVertexProvider(googleCredential.config).embeddingModel(
        "text-embedding-005"
      ),
      provider: "google",
      modelId: "text-embedding-005",
      credentialKind: googleCredential.kind,
    };
  }
  if (
    googleCredential &&
    "apiKey" in googleCredential &&
    typeof googleCredential.apiKey === "string"
  ) {
    return {
      model: createGoogleGenerativeAI({
        apiKey: googleCredential.apiKey,
      }).textEmbedding("gemini-embedding-001"),
      provider: "google",
      modelId: "gemini-embedding-001",
      credentialKind: googleCredential.kind,
    };
  }
  return null;
}

/**
 * OpenAI-compatible endpoint (#436): connection or OPENAI_COMPATIBLE_* env,
 * only when it declares an embedding model — a chat-only endpoint keeps the
 * lexical fallback. Last in the automatic order; an Organization that wants
 * its local model to embed picks the connection explicitly (#437).
 */
function compatibleEmbedding(
  connections: ProviderConnection[]
): ResolvedEmbeddingModel | null {
  const compatible = resolveProviderCredential("openai_compatible", connections);
  if (
    compatible?.provider === "openai_compatible" &&
    "config" in compatible &&
    compatible.config.embeddingModel
  ) {
    return {
      model: createOpenAICompatible({
        name: "openai-compatible",
        baseURL: compatible.config.baseUrl,
        apiKey: compatible.apiKey ?? undefined,
      }).textEmbeddingModel(compatible.config.embeddingModel),
      provider: "openai_compatible",
      modelId: compatible.config.embeddingModel,
      credentialKind: compatible.kind,
    };
  }
  return null;
}

/**
 * The embedding half of the usage-recording seam (#438): one ledger row per
 * successful embed/embedMany call. Providers that omit usage meter zero
 * tokens (the call itself still counts); a missing context skips the row.
 */
async function recordEmbedUsage(
  resolved: ResolvedEmbeddingModel,
  tokens: unknown,
  attribution: EmbeddingUsageContext | null
): Promise<void> {
  if (!attribution) return;
  await meterUsage(attribution.db, [
    {
      organizationId: attribution.organizationId,
      assistantId: attribution.assistantId ?? null,
      conversationId: attribution.conversationId ?? null,
      stage: "embed",
      provider: resolved.provider,
      modelId: resolved.modelId,
      credentialKind: resolved.credentialKind,
      inputTokens:
        typeof tokens === "number" && Number.isFinite(tokens) ? tokens : 0,
      outputTokens: 0,
    },
  ]);
}

export async function embedText(
  text: string,
  connections: ProviderConnection[],
  attribution: EmbeddingUsageContext | null
): Promise<number[] | null> {
  const resolved = getEmbeddingModel(connections);
  if (!resolved) return null;
  try {
    const result = await embed({ model: resolved.model, value: text });
    await recordEmbedUsage(resolved, result.usage?.tokens, attribution);
    return padEmbedding(result.embedding);
  } catch {
    return null;
  }
}

/**
 * How a batch embedding attempt ended. `no_model` is a configuration state
 * (no embedding-capable provider — lexical-only is expected); `error` is an
 * operational failure (provider call threw) that callers should surface —
 * silently landing null embeddings hides knowledge from vector search (#312).
 */
export type EmbeddingBatchMode = "ok" | "no_model" | "error";

export async function embedTextsWithStatus(
  texts: string[],
  connections: ProviderConnection[],
  attribution: EmbeddingUsageContext | null
): Promise<{ embeddings: (number[] | null)[]; mode: EmbeddingBatchMode }> {
  const resolved = getEmbeddingModel(connections);
  if (!resolved) return { embeddings: texts.map(() => null), mode: "no_model" };
  if (texts.length === 0) return { embeddings: [], mode: "ok" };
  try {
    const result = await embedMany({ model: resolved.model, values: texts });
    await recordEmbedUsage(resolved, result.usage?.tokens, attribution);
    return { embeddings: result.embeddings.map(padEmbedding), mode: "ok" };
  } catch (error) {
    console.error("[embeddings] batch embedding failed:", error);
    return { embeddings: texts.map(() => null), mode: "error" };
  }
}

export async function embedTexts(
  texts: string[],
  connections: ProviderConnection[],
  attribution: EmbeddingUsageContext | null
): Promise<(number[] | null)[]> {
  return (await embedTextsWithStatus(texts, connections, attribution))
    .embeddings;
}
