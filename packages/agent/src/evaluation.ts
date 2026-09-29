import { Experimental_EvaluationLanguageModel as EvaluationLanguageModel } from "@ai-sdk/provider-utils/experimental-evaluation";
import { createGateway, rerank } from "ai";
import {
  estimateCostEur,
  gradeEvaluation,
  messageFlowCandidates,
  type Assistant,
  type EvaluationCandidate,
  type EvaluationExample,
  type EvaluationResult,
  type EvaluationStage,
  type Flow,
  type PlatformEvalModel,
  type ProviderConnection,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { classifyIntent, runAssistantChat } from "./engine";
import { buildKnowledgeSearcher } from "./retrieval";
import { estimateRerankTokens } from "./rerank";
import { gatewayModelId } from "./catalog";
import { adapterModel } from "./decision-model";
import { createTurnSession } from "./session";
import { getRuntimeHost } from "./host";
import { resolveChatModel, resolveProviderCredential } from "./models";
import { runPreflight } from "./preflight-shadow";
import { usageTotals } from "./usage";
import {
  admitAiSpend,
  CONVERSATION_SPEND_CAPACITY,
  spendConnectionKinds,
} from "./spend-admission";
import type { ChatReplyPart, UsageEvent } from "./types";

const SAFE_ACTIONS = new Set([
  "custom_message",
  "basic_reply",
  "search_knowledge",
  "follow_up_questions",
  "show_button",
]);

/** One synthetic case. No Conversation is created and effectful Flow actions are removed. */
export async function evaluateCase(input: {
  db: Db;
  assistant: Assistant;
  flows: Flow[];
  connections: ProviderConnection[];
  example: EvaluationExample;
  candidate: EvaluationCandidate;
  stage: EvaluationStage;
  modelPrice?: Pick<PlatformEvalModel, "inputEurPerMillion" | "outputEurPerMillion">;
}): Promise<EvaluationResult> {
  const { db, assistant, flows, connections, example, candidate, stage, modelPrice } =
    input;
  const started = performance.now();
  const usage: UsageEvent[] = [];
  let answer = "";
  let flowId: string | null = null;
  let sourceUrls: string[] = [];
  let autonomous: boolean | null =
    stage === "classifier" || stage === "reranker" ? null : true;
  let error: string | null = null;
  let rerankTokens = 0;
  let rerankCalled = false;
  const credential =
    candidate.provider === "typesafe" || candidate.provider === "voyage"
      ? ("platform" as const)
      : // With the Gateway, as the chat stages resolve the model: a candidate
        // only the platform's Gateway key serves is still platform spend.
        resolveProviderCredential(candidate.provider, connections, { gateway: true })?.kind;
  const admission = await admitAiSpend({
    db,
    organizationId: assistant.organizationId,
    connectionKinds: spendConnectionKinds(credential),
    capacity: CONVERSATION_SPEND_CAPACITY,
  });
  const question = example.inputs.question;
  const signal = AbortSignal.timeout(20_000);
  const routing = { url: example.inputs.launch_url, now: new Date() };

  try {
    if (admission.blocked) throw new Error(admission.blocked.detail);
    if (stage === "classifier") {
      if (candidate.provider === "typesafe" || candidate.provider === "voyage")
        throw new Error("The classifier requires a chat model.");
      const selected = resolveChatModel(
        candidate.provider,
        candidate.modelId,
        connections,
      );
      if (
        !selected ||
        selected.provider !== candidate.provider ||
        selected.modelId !== candidate.modelId
      ) {
        throw new Error(
          "The requested model is not available. Check the provider connection.",
        );
      }
      const match = await classifyIntent(
        question,
        flows,
        selected.model,
        assistant.nickname,
        (raw) => {
          usage.push({
            stage: "classify",
            provider: selected.provider,
            modelId: selected.modelId,
            credentialKind: selected.credentialKind,
            ...usageTotals(raw),
          });
        },
        routing,
        undefined,
        signal,
      );
      flowId = match?.id ?? null;
      answer = match?.name ?? "No Flow";
    } else if (stage === "preflight") {
      const resolved = evaluationModel(candidate, connections);
      const selectedDeskIds = new Set(
        assistant.helpDeskSettings?.selectedIds ?? [],
      );
      const [faqs, helpDesks] = await Promise.all([
        db.listAssistantFaqOptions(assistant.id),
        selectedDeskIds.size
          ? db.listHelpDesks(assistant.organizationId)
          : Promise.resolve([]),
      ]);
      const outcome = await runPreflight({
        message: question,
        catalogue: {
          flows: messageFlowCandidates(flows, routing),
          faqs,
          desks: helpDesks
            .filter((desk) => selectedDeskIds.has(desk.id))
            .map((desk) => ({
              id: desk.id,
              name: desk.name,
              description: desk.description,
            })),
        },
        resolved,
        recordUsage: (event) => usage.push(event),
      });
      if (!outcome || outcome.record.failure)
        throw new Error(
          outcome?.record.failure
            ? JSON.stringify(outcome.record.failure)
            : "No pre-flight model is available.",
        );
      const flowAnswer = outcome.record.answers.find(
        (item) => item.id === "flow",
      );
      flowId = typeof flowAnswer?.value === "string" ? flowAnswer.value : null;
      if (flowId === "default")
        flowId =
          flows.find((flow) => flow.isDefault && flow.enabled)?.id ?? null;
      answer = outcome.record.answers
        .map((item) => `${item.id}: ${item.value}`)
        .join(" · ");
      autonomous = outcome.record.wouldRoute.kind !== "fallback";
    } else if (stage === "reranker") {
      if (
        candidate.provider !== "voyage" ||
        !["voyage/rerank-2.5", "voyage/rerank-2.5-lite"].includes(
          candidate.modelId,
        )
      ) {
        throw new Error("Select one of the supported Voyage models.");
      }
      const apiKey = process.env.AI_GATEWAY_API_KEY;
      if (!apiKey)
        throw new Error("The reranker requires AI Gateway, which is not configured.");
      const model = createGateway({ apiKey }).rerankingModel(candidate.modelId);
      const search = buildKnowledgeSearcher({
        db,
        connections,
        assistant,
        collectionId: null,
        conversationId: null,
        usage: { surface: "preview" },
        reranker: async (query, hits, limit) => {
          if (hits.length < 2) return hits.slice(0, limit);
          const documents = hits.map((hit) => hit.content);
          const result = await rerank({
            model,
            query,
            documents,
            topN: limit,
            maxRetries: 0,
            abortSignal: signal,
          });
          rerankCalled = true;
          rerankTokens += estimateRerankTokens(query, documents);
          return result.ranking
            .map((rank) => hits[rank.originalIndex])
            .filter((hit): hit is NonNullable<typeof hit> => !!hit);
        },
      });
      const hits = await search(question, { scope: "assistant" });
      if (!rerankCalled)
        throw new Error("Comparing rerankers needs at least two candidate sources.");
      sourceUrls = hits
        .map((hit) => hit.resourceUrl)
        .filter((url): url is string => !!url);
      answer = hits.map((hit) => hit.conceptTitle).join(" · ");
    } else {
      if (candidate.provider === "typesafe" || candidate.provider === "voyage")
        throw new Error("This stage requires a chat model.");
      const fallbackResolution =
        stage === "fallback"
          ? {
              allowedProviders: [candidate.provider],
              fallbackModel: {
                provider: candidate.provider,
                modelId: candidate.modelId,
              },
            }
          : undefined;
      const selected =
        stage === "fallback"
          ? resolveChatModel(
              assistant.modelProvider,
              assistant.modelId,
              connections,
              fallbackResolution,
            )
          : resolveChatModel(
              candidate.provider,
              candidate.modelId,
              connections,
            );
      if (
        !selected ||
        selected.provider !== candidate.provider ||
        selected.modelId !== candidate.modelId ||
        (stage === "fallback" && !selected.usedFallback)
      ) {
        throw new Error(
          "The requested model is not available. Check the provider connection.",
        );
      }
      const safeFlows = flows.map((flow) => ({
        ...flow,
        actions: flow.actions.filter((action) => SAFE_ACTIONS.has(action)),
      }));
      const syntheticAssistant = {
        ...assistant,
        modelProvider:
          stage === "orchestration" || stage === "fallback"
            ? assistant.modelProvider
            : candidate.provider,
        modelId:
          stage === "orchestration" || stage === "fallback"
            ? assistant.modelId
            : candidate.modelId,
        tools: { builtIns: { searchKnowledge: true } },
      };
      const searchKnowledge = buildKnowledgeSearcher({
        db,
        connections,
        assistant,
        collectionId: null,
        conversationId: null,
        usage: { surface: "preview" },
      });
      const result = await runAssistantChat({
        assistant: syntheticAssistant,
        platformPrompt: await getRuntimeHost().getPlatformSystemPrompt(),
        flows: safeFlows,
        connections,
        classifierOverride: stage === "orchestration" ? selected : undefined,
        keyResolution: fallbackResolution,
        message: question,
        history: example.inputs.history ?? [],
        searchKnowledge,
        session: createTurnSession(`eval-${example.id}-${candidate.modelId}`, {
          memory: example.inputs.memory ?? [],
        }),
        routing,
        emit: () => {},
        signal,
      });
      usage.push(...result.usage);
      flowId = result.flowId;
      const executedFlow = flows.find((flow) => flow.id === flowId);
      if (executedFlow?.actions.some((action) => !SAFE_ACTIONS.has(action))) {
        error =
          "The Flow contains actions with external effects. A synthetic run does not execute them.";
      }
      answer = result.parts
        .filter(
          (part): part is Extract<ChatReplyPart, { type: "text" }> =>
            part.type === "text",
        )
        .map((part) => part.text)
        .join("\n\n");
      sourceUrls = result.parts
        .filter(
          (part): part is Extract<ChatReplyPart, { type: "sources" }> =>
            part.type === "sources",
        )
        .flatMap((part) =>
          part.sources
            .map((source) => source.url)
            .filter((url): url is string => !!url),
        );
      autonomous =
        !error &&
        !!answer &&
        !result.parts.some(
          (part) =>
            part.type === "text" &&
            ["fallback", "refusal"].includes(part.action),
        ) &&
        result.flowId !== null;
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Unknown error";
    if (autonomous !== null) autonomous = false;
  }

  const inputTokens = usage.reduce(
    (sum, event) => sum + event.inputTokens,
    rerankTokens,
  );
  const outputTokens = usage.reduce(
    (sum, event) => sum + event.outputTokens,
    0,
  );
  const costEur =
    usage.reduce(
      (sum, event) =>
        sum +
        (modelPrice && event.provider === candidate.provider && event.modelId === candidate.modelId
          ? (event.inputTokens * modelPrice.inputEurPerMillion +
              event.outputTokens * modelPrice.outputEurPerMillion) / 1_000_000
          : estimateCostEur(
              event.provider,
              event.modelId,
              event.inputTokens,
              event.outputTokens,
            )),
      0,
    ) +
    (rerankTokens
      ? estimateCostEur("voyage", candidate.modelId, rerankTokens, 0)
      : 0);
  try {
    await admission.settle([
      ...usage.map((event) => ({
        organizationId: assistant.organizationId,
        assistantId: assistant.id,
        stage: "evaluation" as const,
        provider: event.provider,
        modelId: event.modelId,
        credentialKind: event.credentialKind,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        surface: "preview" as const,
      })),
      ...(rerankTokens
        ? [
            {
              organizationId: assistant.organizationId,
              assistantId: assistant.id,
              stage: "evaluation" as const,
              provider: "voyage" as const,
              modelId: candidate.modelId,
              credentialKind: "platform" as const,
              inputTokens: rerankTokens,
              outputTokens: 0,
              surface: "preview" as const,
            },
          ]
        : []),
    ]);
  } finally {
    await admission.release();
  }
  const flowName = flows.find((flow) => flow.id === flowId)?.name ?? null;
  return {
    exampleId: example.id,
    candidate,
    answer,
    flowId,
    flowName,
    sourceUrls,
    latencyMs: Math.round(performance.now() - started),
    inputTokens,
    outputTokens,
    costEur,
    accuracy: gradeEvaluation(stage, example.reference_outputs, {
      answer,
      flowId,
      flowName,
      sourceUrls,
      error,
    }),
    autonomous,
    error,
  };
}

/** Exported for its test; the barrel does not re-export it. */
export function evaluationModel(
  candidate: EvaluationCandidate,
  connections: ProviderConnection[],
) {
  if (
    candidate.provider === "voyage" ||
    candidate.provider === "openai_compatible"
  )
    throw new Error("This provider has no pre-flight model.");
  if (candidate.provider === "typesafe") {
    const apiKey = process.env.AI_GATEWAY_API_KEY;
    if (!apiKey || candidate.modelId !== "typesafe-ai/jev")
      throw new Error("Jev requires AI Gateway and the typesafe-ai/jev model.");
    return {
      model: createGateway({ apiKey }).evaluationModel(candidate.modelId),
      backend: "jev" as const,
      provider: "typesafe" as const,
      modelId: candidate.modelId,
      credentialKind: "platform" as const,
      calibrated: true,
    };
  }
  // With the Gateway, as the chat stages resolve a candidate: a model only AI
  // Gateway serves is wrapped the way the providers' own SDKs wrap theirs, so
  // the adapter backend reads it like any other uncalibrated model.
  const credential = resolveProviderCredential(candidate.provider, connections, {
    gateway: true,
  });
  if (!credential || !("apiKey" in credential) || !credential.apiKey)
    throw new Error("No credential is available for this provider.");
  if ("route" in credential && credential.route === "gateway") {
    const gatewayId = gatewayModelId(candidate.provider, candidate.modelId);
    if (!gatewayId)
      throw new Error("AI Gateway does not serve this model.");
    return {
      model: new EvaluationLanguageModel({
        model: createGateway({ apiKey: credential.apiKey }).languageModel(gatewayId),
        provider: "gateway.evaluation",
      }),
      backend: "adapter" as const,
      provider: candidate.provider,
      modelId: candidate.modelId,
      credentialKind: credential.kind,
      calibrated: false,
    };
  }
  const model = adapterModel(candidate.provider, candidate.modelId, credential.apiKey);
  return {
    model,
    backend: "adapter" as const,
    provider: candidate.provider,
    modelId: candidate.modelId,
    credentialKind: credential.kind,
    calibrated: false,
  };
}
