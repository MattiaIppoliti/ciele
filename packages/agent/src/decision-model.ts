import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createTypeSafeAi } from "@ai-sdk/typesafe-ai";
import {
  createGateway,
  experimental_evaluate,
  type Experimental_EvaluationModel,
  type Experimental_EvaluationQuestion,
  type Experimental_EvaluationResult,
} from "ai";
import type {
  AiCredentialKind,
  Provider,
  ProviderConnection,
  UsageProvider,
} from "@agent-hub/core";
import {
  CLASSIFIER_MODEL,
  mayUsePersonalSubscription,
  resolveProviderCredential,
  type CatalogProvider,
  type KeyResolution,
} from "./models";
import type { UsageEvent } from "./types";
import { usageTotals } from "./usage";

/**
 * The decision model (#950, spec #948): a *decision* is one `evaluate` call, a
 * state plus a map of typed questions (choice, score, boolean) answered with
 * probabilities and never with prose. It sits beside the classifier-model
 * resolver in `models.ts` rather than inside it, because an evaluation model
 * is a different type from a `LanguageModel` and the `Provider` union that keys
 * the catalogue, pricing and a check constraint does not widen for it (#943).
 *
 * Two backends behind one interface:
 * - `jev`: TypeSafe's Jev, calibrated confidence, reached through a **platform**
 *   key only. The Gateway (`AI_GATEWAY_API_KEY`, model `typesafe-ai/jev`) is
 *   preferred when both keys exist, because its model card states zero data
 *   retention and no training for that model; the direct provider
 *   (`TYPESAFE_AI_API_KEY`, `jev-latest`) is the one that returns the resolved
 *   version in `response.modelId`.
 * - `adapter`: with no platform key, the same question map runs through the AI
 *   SDK's structured-output adapter on the Organization's classifier model,
 *   `calibrated: false`. A self-host with no key runs identical code.
 *
 * A personal subscription never resolves here at all: Jev is platform-funded
 * and a decision on Visitor traffic is not personal use (ADR-0001, ADR-0007),
 * and the local CLI model has no evaluation adapter.
 */

const GATEWAY_ENV = "AI_GATEWAY_API_KEY";
const TYPESAFE_ENV = "TYPESAFE_AI_API_KEY";
/** The Gateway's one TypeSafe id; it hides the resolved version (#940). */
export const JEV_GATEWAY_MODEL_ID = "typesafe-ai/jev";
/** The direct provider's alias; `response.modelId` carries the version. */
export const JEV_DIRECT_MODEL_ID = "jev-latest";

export type DecisionBackend = "jev" | "adapter";

export interface ResolvedDecisionModel {
  model: Experimental_EvaluationModel;
  backend: DecisionBackend;
  /** What the usage ledger records as the provider that ran. */
  provider: UsageProvider;
  /** The id that was requested; the ledger prices from it. */
  modelId: string;
  credentialKind: AiCredentialKind;
  /**
   * Whether the answers' probabilities are calibrated. Only Jev's are; under
   * the adapter, thresholds degrade to "accept the choice" (#943).
   */
  calibrated: boolean;
}

const ADAPTER_PROVIDERS: readonly CatalogProvider[] = ["anthropic", "openai", "google"];

function isCatalogProvider(provider: Provider): provider is CatalogProvider {
  return (ADAPTER_PROVIDERS as readonly string[]).includes(provider);
}

/**
 * Resolves the evaluation model for one decision, in the order the spec fixes:
 * platform Gateway key, platform TypeSafe key, then the adapter over the first
 * provider with a credential (the Assistant's own first). Null when nothing can
 * evaluate, which callers treat exactly as "no decision", today's path.
 */
export function resolveDecisionModel(
  preferredProvider: Provider,
  connections: ProviderConnection[],
  resolution: KeyResolution = {}
): ResolvedDecisionModel | null {
  // A Member's turn on their own subscription: the platform key must not fund
  // it, and the CLI model cannot evaluate, so there is no decision at all.
  if (
    mayUsePersonalSubscription(resolution) &&
    (resolution.localSubscriptionProviders?.length ?? 0) > 0
  ) {
    return null;
  }

  const gatewayKey = process.env[GATEWAY_ENV];
  if (gatewayKey) {
    return {
      model: createGateway({ apiKey: gatewayKey }).evaluationModel(JEV_GATEWAY_MODEL_ID),
      backend: "jev",
      provider: "typesafe",
      modelId: JEV_GATEWAY_MODEL_ID,
      credentialKind: "platform",
      calibrated: true,
    };
  }
  const typesafeKey = process.env[TYPESAFE_ENV];
  if (typesafeKey) {
    return {
      model: createTypeSafeAi({ apiKey: typesafeKey }).evaluationModel(JEV_DIRECT_MODEL_ID),
      backend: "jev",
      provider: "typesafe",
      modelId: JEV_DIRECT_MODEL_ID,
      credentialKind: "platform",
      calibrated: true,
    };
  }

  // The adapter exists for the three catalogue providers only: no
  // `evaluationModel()` on openai-compatible endpoints, on Vertex federated
  // credentials, or on the V3 local-subscription model, so those are skipped
  // rather than wrapped.
  const order = [preferredProvider, ...ADAPTER_PROVIDERS].filter(
    (provider, index, providers) => providers.indexOf(provider) === index
  );
  for (const provider of order) {
    if (!isCatalogProvider(provider)) continue;
    const credential = resolveProviderCredential(provider, connections, resolution);
    if (!credential || !("apiKey" in credential) || credential.apiKey === null) continue;
    const modelId = CLASSIFIER_MODEL[provider];
    return {
      model: adapterModel(provider, modelId, credential.apiKey),
      backend: "adapter",
      provider,
      modelId,
      credentialKind: credential.kind,
      calibrated: false,
    };
  }
  return null;
}

function adapterModel(
  provider: CatalogProvider,
  modelId: string,
  apiKey: string
): Experimental_EvaluationModel {
  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey }).evaluationModel(modelId);
    case "openai":
      return createOpenAI({ apiKey }).evaluationModel(modelId);
    case "google":
      return createGoogleGenerativeAI({ apiKey }).evaluationModel(modelId);
    default:
      throw new Error(`No evaluation adapter for ${provider satisfies never}`);
  }
}

export interface Decision<Q extends Record<string, Experimental_EvaluationQuestion>> {
  answers: Experimental_EvaluationResult<Q>["answers"];
  /**
   * Jev's calibrated confidence per question id (Choice and Score only; a
   * Boolean carries its probability on the answer). Empty under the adapter,
   * which is how a caller tells the fallback apart without a flag.
   */
  confidence: Readonly<Record<string, number>>;
  backend: DecisionBackend;
  calibrated: boolean;
  /**
   * The model the response named. On the direct path this is the resolved
   * version (`jev-1.13.0`); the Gateway echoes the requested id (#940).
   */
  resolvedModelId: string;
  latencyMs: number;
  /** The ledger row for this call, for the turn's `usageEvents`. */
  usage: UsageEvent;
  warnings: Experimental_EvaluationResult<Q>["warnings"];
}

/**
 * One decision: runs the question map against the state on the resolved model
 * and returns the typed answers with the usage event the caller meters. Errors
 * propagate: a caller decides whether a failed decision means "fall back" (it
 * always does for routing) and never lets it undo work already done.
 */
export async function decide<const Q extends Record<string, Experimental_EvaluationQuestion>>(
  resolved: ResolvedDecisionModel,
  input: {
    state: Parameters<typeof experimental_evaluate>[0]["state"];
    questions: Q;
    abortSignal?: AbortSignal;
  }
): Promise<Decision<Q>> {
  const startedAt = performance.now();
  const result = await experimental_evaluate({
    model: resolved.model,
    state: input.state,
    questions: input.questions,
    abortSignal: input.abortSignal,
  });
  return {
    answers: result.answers,
    confidence: confidenceOf(result.providerMetadata),
    backend: resolved.backend,
    calibrated: resolved.calibrated,
    resolvedModelId: result.response.modelId,
    latencyMs: Math.round(performance.now() - startedAt),
    usage: {
      stage: "decide",
      provider: resolved.provider,
      modelId: resolved.modelId,
      credentialKind: resolved.credentialKind,
      ...usageTotals(result.usage),
    },
    warnings: result.warnings,
  };
}

/**
 * `providerMetadata.typesafe.confidence`, keyed by question id, read
 * defensively: the adapter never sets it, the Gateway relays it (#940), and a
 * malformed value must read as "no confidence", never throw.
 */
function confidenceOf(metadata: unknown): Readonly<Record<string, number>> {
  const raw = (metadata as { typesafe?: { confidence?: unknown } } | undefined)?.typesafe
    ?.confidence;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value)) out[id] = value;
  }
  return out;
}
